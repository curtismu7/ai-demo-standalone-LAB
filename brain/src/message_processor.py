# Adapted from AI-DEMO2 langchain_agent/src/api/message_processor.py (MIT; see docs/PROVENANCE.md):
# ONLY the BFF-tool branch's streaming core, cut for this lab — no MCP graph, no guardrails
# (grounding check removed), no Opik callbacks, no per-run provider override, no Helix, no
# session/checkpointer (stateless per-run graph). The system prompt is this lab's own.
# Kept from the source: astream_events text/tool routing, the deterministic policy-denial
# fallback, the no-visible-output guard, and the pre-model token trim.
"""The brain's one turn: a stateless per-run LangGraph over the lab's tool route, streamed."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Authorization / gateway policy-denial markers the lab's tool route returns
# ("denied: <reason>"); kept from the source repo's denial-surface logic.
_SYSTEM_PROMPT = """You are the airline service agent in a Ping Identity security demo. You help with flight bookings, refunds, balance and loyalty reads.
You have tools for these actions; choose the right tool and fill its arguments from what the visitor asked (amounts they name are the amounts to use).
Every tool call is checked by the policy engine (PingOne Authorize): the result may be a permit, a denial, or a consent/MFA requirement.
When a tool result denies the action, tell the visitor plainly what was denied and why - never pretend the action succeeded.
When a tool result asks for consent or step-up, ask the visitor to approve before you continue.
Never invent tool results, amounts or balances. Keep replies short and factual."""

_DENIED_MARK = "denied"


def _reply_surfaces_denial(reply: str) -> bool:
    """Did the model's reply already explain the denial? Prevents doubling the
    deterministic notice when the system-prompt rule worked."""
    r = (reply or "").lower()
    if not r.strip():
        return False
    return any(kw in r for kw in ("den", "block", "not allow", "scope", "policy", "restrict", "out of"))


def _content_to_text(content: Any) -> str:
    """Flatten provider content: OpenAI-style models stream a str; some providers
    stream a list of content blocks (carried from the source repo)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            c.get("text", "") for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        )
    return str(content or "")


def _tool_result_text(output: Any) -> str:
    if isinstance(output, str):
        return output
    try:
        content = getattr(output, "content", None)
        return content if isinstance(content, str) else str(output)
    except Exception:
        return str(output)


def _extract_policy_denial(tool_calls: List[Dict[str, Any]]) -> Optional[str]:
    """The lab's tool route returns {result: {result: 'DENIED'|'OBLIGATION', reason|code}}.
    Pull the first denial reason out so the user always sees WHY it was blocked."""
    for tc in tool_calls:
        result = tc.get("result") or ""
        try:
            data = json_loads(result) if isinstance(result, str) else result
        except Exception:
            data = None
        r = data.get("result") if isinstance(data, dict) else None
        if isinstance(r, dict):
            # envelope form {result: {...}}
            if str(r.get("result", "")).upper() in ("DENIED", "OBLIGATION"):
                return str(r.get("reason") or r.get("code") or r.get("result"))
        elif isinstance(data, dict):
            # flat form: the tool route unwraps the envelope, so the tool string is the
            # engine result itself {"result": "DENIED"|"OBLIGATION", reason|code}
            if str(data.get("result", "")).upper() in ("DENIED", "OBLIGATION"):
                return str(data.get("reason") or data.get("code") or data.get("result"))
    return None


def json_loads(s: str):
    import json
    return json.loads(s)


class BrainProcessor:
    """Runs one turn through a stateless per-run graph over the lab's tool route."""

    def __init__(self, tools: list, llm, max_context_tokens: int = 8000):
        self._tools = tools
        self._llm = llm
        self._max_context_tokens = max_context_tokens

    def _pre_model_hook(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Bound what the LLM reads per turn (carried from the source repo's hook:
        override the model input only; the state is not rewritten)."""
        from langchain_core.messages import trim_messages
        from langchain_core.messages.utils import count_tokens_approximately
        trimmed = trim_messages(
            state["messages"], strategy="last", include_system=True,
            token_counter=count_tokens_approximately,
            max_tokens=self._max_context_tokens, start_on="human", allow_partial=False,
        )
        return {"llm_input_messages": trimmed}

    async def process_run(
        self,
        message: str,
        emitter,
        bff_tool_url: str,
        bff_internal_secret: str,
        session_id: str,
        run_id: str,
        messages_list: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """One stateless run: build the graph, feed the history, stream AG-UI events."""
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
        from langchain_core.runnables import RunnableConfig
        from langgraph.prebuilt import create_react_agent

        # Rebuild the engine tools per run so each EngineTool carries this run's
        # session id and run id (the app passes the schemas at boot; here they
        # are re-derived from the ready-made tools' args schemas).
        from engine_tools import build_engine_tools

        if self._llm is None:
            await emitter.on_run_start()
            await emitter.on_error(RuntimeError("No model is configured (AIDEMO_BRAIN_URL unset)"))
            return

        engine_tools = build_engine_tools(
            [{"name": t.name, "description": t.description, "inputSchema": t.args_schema.model_json_schema()} for t in self._tools],
            bff_tool_url, session_id, run_id, bff_internal_secret,
        )

        graph = create_react_agent(self._llm, engine_tools, pre_model_hook=self._pre_model_hook)
        config = RunnableConfig(recursion_limit=25)

        def _to_lc(msgs):
            result = []
            for m in msgs or []:
                role = m.get("role", "user")
                content = m.get("content", "")
                if isinstance(content, list):
                    content = " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
                if role == "user":
                    result.append(HumanMessage(content=content))
                elif role == "assistant":
                    result.append(AIMessage(content=content))
                elif role == "system":
                    result.append(SystemMessage(content=content))
            return result

        hist = _to_lc(messages_list)
        if not hist or not isinstance(hist[0], SystemMessage):
            hist = [SystemMessage(content=_SYSTEM_PROMPT)] + hist
        hist = hist + [HumanMessage(content=message)]

        llm_streaming = False
        total_input_tokens = 0
        total_output_tokens = 0
        turn_reply_text = ""
        pending_tool_calls: dict = {}
        turn_tool_calls: list = []
        any_visible_output = False

        await emitter.on_run_start()
        async for event in graph.astream_events({"messages": hist}, config=config, version="v2"):
            event_name = event.get("event")
            event_data = event.get("data") or {}

            if event_name == "on_chat_model_stream":
                chunk = event_data.get("chunk")
                token = _content_to_text(getattr(chunk, "content", "")) if chunk is not None else ""
                if token:
                    if not llm_streaming:
                        await emitter.on_llm_start()
                        llm_streaming = True
                    await emitter.on_llm_new_token(token)
                    turn_reply_text += token
                    any_visible_output = True

                if not token:
                    # the non-streaming path: a single-shot answer on chunk==None
                    output = event_data.get("output")
                    final_text = _content_to_text(getattr(output, "content", "")) if output is not None else ""
                    if final_text:
                        await emitter.on_llm_start()
                        await emitter.on_llm_new_token(final_text)
                        await emitter.on_llm_end()
                        any_visible_output = True
                        turn_reply_text += final_text

                try:
                    output = event_data.get("output")
                    if output is not None and (usage := getattr(output, "usage_metadata", None)):
                        if isinstance(usage, dict):
                            total_input_tokens += usage.get("input_tokens", 0) or 0
                            total_output_tokens += usage.get("output_tokens", 0) or 0
                except Exception:
                    pass

            elif event_name == "on_tool_start":
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                serialized = {"name": event.get("name", "unknown_tool")}
                tool_call_id = event.get("run_id")
                pending_tool_calls[tool_call_id] = {"name": event.get("name", "unknown_tool"), "args": event_data.get("input")}
                any_visible_output = True
                await emitter.on_tool_start(serialized, tool_call_id=tool_call_id, inputs=event_data.get("input"))

            elif event_name == "on_tool_end":
                output = event_data.get("output", "")
                tool_call_id = event.get("run_id")
                pending = pending_tool_calls.pop(tool_call_id, None)
                if pending is not None:
                    turn_tool_calls.append({"name": pending["name"], "args": pending["args"], "result": _tool_result_text(output)})
                await emitter.on_tool_end(output, tool_call_id=tool_call_id)

            elif event_name == "on_chain_error":
                error = event_data.get("error") or RuntimeError("Agent chain error")
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                await emitter.on_error(error)
                return

        if llm_streaming:
            await emitter.on_llm_end()

        # Deterministic policy-denial fallback (carried from the source): the user
        # always sees WHY it was blocked, even if the model changed the subject.
        _denial = _extract_policy_denial(turn_tool_calls)
        if _denial and not _reply_surfaces_denial(turn_reply_text):
            _notice = f"❌ {_denial}"
            await emitter.on_llm_start()
            await emitter.on_llm_new_token(_notice)
            await emitter.on_llm_end()
            turn_reply_text += ("\n" if turn_reply_text else "") + _notice
            any_visible_output = True

        if not any_visible_output:
            logger.warning("[AG-UI] run produced no visible output for session %s", session_id)
            await emitter.on_error(RuntimeError(
                "The model didn't return a usable response. Try rephrasing your request or sending it again."))
            return

        if total_input_tokens or total_output_tokens:
            await emitter.on_usage(total_input_tokens, total_output_tokens)

        logger.info("[AG-UI] process_run complete for session %s", session_id)
