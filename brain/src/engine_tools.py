# This lab's own adapter (new code for P2b): LangChain tools whose every call posts to the
# lab's POST /api/assistant/tool route — the SAME route the Scripted brain's engine path
# uses — so a model-chosen tool call is executed by the mock engine with the same rules
# (decideWithObligation, the group gate, the HITL bands). Mirrors agui/bff_tool_adapter.py's
# BffTool wire shape ({tool, args, sessionId}, the per-boot shared secret header).
import json
import logging
from typing import Any, Dict, List, Type

import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, PrivateAttr

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


def build_engine_tools(
    tool_schemas: List[Dict[str, Any]],
    tool_url: str,
    session_id: str,
    run_id: str,
    secret: str,
) -> List[BaseTool]:
    """One EngineTool per schema from the lab (name, description, inputSchema)."""
    tools = []
    for schema in tool_schemas:
        tools.append(EngineTool(
            name=schema.get("name", "unknown_tool"),
            description=schema.get("description", ""),
            args_schema=_schema_to_model(schema.get("name", "tool"), schema.get("inputSchema") or {"type": "object", "properties": {}}),
            tool_url=tool_url, session_id=session_id, run_id=run_id, secret=secret,
        ))
    logger.info("[EngineTool] built %d tools for session %s", len(tools), session_id)
    return tools


def _schema_to_model(name: str, input_schema: Dict[str, Any]) -> Type[BaseModel]:
    """JSON Schema -> a dynamic Pydantic args_schema (mirrors bff_tool_adapter)."""
    from pydantic import create_model, Field
    properties = input_schema.get("properties") or {}
    required = set(input_schema.get("required") or [])
    if not properties:
        return create_model(f"{name}_args")
    fields: Dict[str, Any] = {}
    for prop, spec in properties.items():
        t = {"string": str, "number": float, "integer": int, "boolean": bool}.get(spec.get("type", "string"), str)
        fields[prop] = (t, Field(... if prop in required else spec.get("default"), description=spec.get("description", "")))
    return create_model(f"{name}_args", **fields)


class EngineTool(BaseTool):
    """Calls the lab tool route; returns the engine's {result, hops} as the tool string."""
    name: str
    description: str
    args_schema: Type[BaseModel]
    tool_url: str
    session_id: str
    run_id: str = ""
    _secret: str = PrivateAttr(default="")

    def __init__(self, **kwargs: Any) -> None:
        secret = kwargs.pop("secret", "")
        super().__init__(**kwargs)
        self._secret = secret

    def _run(self, **kwargs: Any) -> str:
        raise NotImplementedError("EngineTool is async only")

    async def _arun(self, **kwargs: Any) -> str:
        args = {k: v for k, v in kwargs.items() if v is not None}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    self.tool_url,
                    json={"tool": self.name, "args": args, "sessionId": self.session_id, "runId": self.run_id},
                    headers={"x-brain-secret": self._secret, "x-session-id": self.session_id},
                )
        except httpx.TimeoutException:
            logger.error("[EngineTool] %s timed out", self.name)
            return (f"Tool '{self.name}' did not respond within 120s. Do NOT retry automatically — "
                    "ask the user to verify the result before trying again.")
        if resp.status_code != 200:
            body = resp.text[:200]
            logger.error("[EngineTool] %s HTTP %s: %s", self.name, resp.status_code, body)
            return f"Tool call failed: HTTP {resp.status_code}: {body}"
        data = resp.json()
        result = data.get("result", data)
        return json.dumps(result) if not isinstance(result, str) else result
