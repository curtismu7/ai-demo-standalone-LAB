# P2b sidecar tests: the scripted tool-calling ChatModel (spike-verified pattern) drives
# the graph with no live LLM; the tool route is a local stub. Runs in CI (Python job).
import asyncio
import json
import os
import sys
from pathlib import Path

# Dev note: create the venv OUTSIDE the repo tree (a sibling scratch dir) so the repo
# tests that scan the tree never see it:  python3.12 -m venv ../brain-venv
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.outputs import ChatGenerationChunk
from langchain_core.messages import AIMessageChunk
from langchain_core.messages import AIMessage
from langgraph.prebuilt import create_react_agent
import pytest


class FakeToolChat(GenericFakeChatModel):
    """Emits AIMessage(tool_calls=[...]) from `TOOL:<name> <json>` lines, then text.

    astream_events streams CHUNKS, and the base fake's chunking drops tool_calls
    (a chunk carries only content), so the tool never fires. Override _astream to
    yield each scripted message as ONE chunk so tool_calls survive streaming.
    """
    def __init__(self, script):
        msgs = []
        for i, s in enumerate(script):
            if s.startswith("TOOL:"):
                name, args = s[5:].split(" ", 1)
                msgs.append(AIMessage(content=" ", tool_calls=[{"name": name, "args": json.loads(args), "id": f"c{i}"}]))
            else:
                msgs.append(AIMessage(content=s))
        super().__init__(messages=iter(msgs))
    def bind_tools(self, tools, **kw):
        return self

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        msg = next(self.messages)
        yield ChatGenerationChunk(message=AIMessageChunk(content=msg.content, tool_calls=list(msg.tool_calls), id=msg.id))


class _Sink:
    def __init__(self):
        self.events = []

    async def __call__(self, event):
        self.events.append(event)


class _Emitter:
    """Records what BrainProcessor emits (the AGUIEventEmitter surface it uses)."""
    def __init__(self):
        self._sink = _Sink()
        self.errors = []

    async def on_run_start(self): await self._sink({"type": "RUN_STARTED"})
    async def on_run_end(self): await self._sink({"type": "RUN_FINISHED"})
    async def on_llm_start(self): pass
    async def on_llm_end(self): pass
    async def on_llm_new_token(self, token): await self._sink({"type": "TEXT", "delta": token})
    async def on_tool_start(self, serialized, tool_call_id=None, **kw): await self._sink({"type": "TOOL_START", "name": serialized.get("name")})
    async def on_tool_end(self, output, tool_call_id=None, **kw): pass
    async def on_usage(self, i, o): pass
    async def on_error(self, error, **kw):
        self.errors.append(str(error))
        await self._sink({"type": "RUN_ERROR", "message": str(error)})


@pytest.fixture()
def recorded_route(monkeypatch):
    """Stub the lab tool route: records calls, answers engine-shaped results."""
    calls = []

    class _Resp:
        status_code = 200
        def json(self):
            return {"result": calls[-1]["result"], "hops": []}

    async def fake_post(self, url, json=None, headers=None):
        calls.append({"tool": json["tool"], "args": json["args"], "headers": headers})
        # engine-shaped result per tool
        if json["tool"] == "refund_booking":
            amount = float(json["args"].get("amount", 0))
            calls[-1]["result"] = ({"result": "OBLIGATION", "code": "consent_required", "amount": amount}
                                   if amount > 250 else {"result": "PERMIT", "refunded": amount})
        else:
            calls[-1]["result"] = {"result": "PERMIT", "balance": 1}
        return _Resp()

    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls


def _processor(script):
    from message_processor import BrainProcessor
    from engine_tools import build_engine_tools
    tools = build_engine_tools(
        [{"name": "check_balance", "description": "Read a balance.", "inputSchema": {"type": "object", "properties": {"user": {"type": "string"}}, "required": ["user"]}},
         {"name": "refund_booking", "description": "Refund a booking.", "inputSchema": {"type": "object", "properties": {"booking_id": {"type": "string"}, "amount": {"type": "number"}}, "required": ["booking_id", "amount"]}}],
        "http://lab.internal/api/assistant/tool", "sess_t", "run_t", "secret-x",
    )
    return BrainProcessor(tools=tools, llm=FakeToolChat(script))


def _text_of(emitter):
    return "".join(e.get("delta", "") for e in emitter._sink.events if e.get("type") == "TEXT")


def test_tool_call_runs_and_narrates(recorded_route):
    em = _Emitter()
    asyncio.run(_processor(["TOOL:refund_booking {\"booking_id\": \"BK-9\", \"amount\": 120}",
                            "Refunded $120."]).process_run(
        message="refund BK-9 $120", emitter=em,
        bff_tool_url="http://lab.internal/api/assistant/tool", bff_internal_secret="secret-x",
        session_id="sess_t", run_id="run_t"))
    assert recorded_route[0]["tool"] == "refund_booking"
    assert recorded_route[0]["args"]["amount"] == 120
    assert recorded_route[0]["headers"]["x-brain-secret"] == "secret-x"
    assert "Refunded" in _text_of(em)
    assert not em.errors


def test_obligation_surfaces_when_reply_ignores_it(recorded_route):
    em = _Emitter()
    asyncio.run(_processor(["TOOL:refund_booking {\"booking_id\": \"BK-9\", \"amount\": 300}",
                            "All done!"]).process_run(
        message="refund BK-9 $300", emitter=em,
        bff_tool_url="http://lab.internal/api/assistant/tool", bff_internal_secret="secret-x",
        session_id="sess_t", run_id="run_t"))
    # the deterministic fallback must state the consent requirement even though the model didn't
    assert "consent_required" in _text_of(em)


def test_no_model_configured_is_honest():
    from message_processor import BrainProcessor
    em = _Emitter()
    bp = BrainProcessor(tools=[], llm=None)
    asyncio.run(bp.process_run(message="hi", emitter=em,
                               bff_tool_url="http://lab.internal/api/assistant/tool",
                               bff_internal_secret="s", session_id="s", run_id="r"))
    assert em.errors and "No model is configured" in em.errors[0]


def test_llm_factory_returns_none_when_url_unset():
    from llm_factory import get_llm
    assert get_llm(provider="llamacpp", llamacpp_base_url="") is None
    assert get_llm(provider="none", llamacpp_base_url="http://x") is None


def test_no_secret_no_call(recorded_route, monkeypatch):
    # the tool must still WORK with an empty secret at the wire level; the LAB route
    # rejects empty secrets (its own test); here we assert the header is passed through
    from message_processor import BrainProcessor
    from engine_tools import build_engine_tools
    tools = build_engine_tools(
        [{"name": "check_balance", "description": "d", "inputSchema": {"type": "object", "properties": {}}}],
        "http://lab.internal/api/assistant/tool", "s", "r", secret="",
    )
    em = _Emitter()
    bp = BrainProcessor(tools=tools, llm=FakeToolChat(["TOOL:check_balance {}", "x"]))
    asyncio.run(bp.process_run(message="m", emitter=em,
                               bff_tool_url="http://lab.internal/api/assistant/tool",
                               bff_internal_secret="", session_id="s", run_id="r"))
    assert recorded_route and recorded_route[0]["headers"]["x-brain-secret"] == ""
