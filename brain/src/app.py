# This lab's brain sidecar entrypoint (P2b). Wires the copied AG-UI slice to this lab's
# tool route and model settings, then serves POST /run (AG-UI SSE), /health.
# OFF by default: the compose service runs only under the `brain` profile and reads
# AIDEMO_BRAIN_URL (default empty -> get_llm returns None and /run answers the honest
# "no model configured" event; the lab container never waits for this service).
from __future__ import annotations

import logging
import os

from fastapi import FastAPI

import metrics

from agui_run_handler import router as agui_router, set_processor
from llm_factory import get_llm
from message_processor import BrainProcessor

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("brain")

app = FastAPI(title="ai-demo-standalone brain", docs_url=None, redoc_url=None)
app.include_router(agui_router)


@app.get("/health")
def health():
    return {"schema": "brain-health/1", "ok": True, **metrics.snapshot()}


def _tool_schemas() -> list:
    """The lab's tool list, from its own export (BRAIN_TOOL_SCHEMAS as JSON)."""
    import json
    raw = os.environ.get("BRAIN_TOOL_SCHEMAS", "[]")
    try:
        schemas = json.loads(raw)
        return schemas if isinstance(schemas, list) else []
    except Exception:
        logger.warning("BRAIN_TOOL_SCHEMAS is not valid JSON; the brain starts with no tools")
        return []


def build_processor():
    llm = get_llm(
        provider=os.environ.get("AIDEMO_BRAIN_PROVIDER", "llamacpp"),
        model=os.environ.get("AIDEMO_BRAIN_MODEL") or None,
        llamacpp_base_url=os.environ.get("AIDEMO_BRAIN_URL", ""),
        llamacpp_model=os.environ.get("AIDEMO_BRAIN_MODEL", "gpt-oss-20b"),
    )
    from engine_tools import build_engine_tools

    tool_url = os.environ.get("AIDEMOLAB_TOOL_URL", "").rstrip("/")
    sessionless_secret = os.environ.get("AIDEMOLAB_BRAIN_SECRET", "")
    schemas = _tool_schemas()
    # EngineTool takes the session id per run; build with a placeholder and rebuild per
    # request is wasteful — instead build once with the run-scoped fields the lab accepts
    # at the route level (the route keys by the x-session-id header, which EngineTool sets).
    tools = build_engine_tools(schemas, tool_url, session_id="*", run_id="", secret=sessionless_secret)
    set_processor(BrainProcessor(tools=tools, llm=llm))
    logger.info("brain ready: model=%s tools=%d url_set=%s",
                os.environ.get("AIDEMO_BRAIN_MODEL", "gpt-oss-20b"), len(tools), bool(os.environ.get("AIDEMO_BRAIN_URL")))
    return llm


build_processor()
