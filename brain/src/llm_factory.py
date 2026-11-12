# Copied from AI-DEMO2 langchain_agent/src/agent/llm_factory.py (MIT; see docs/PROVENANCE.md)
# and cut to the llamacpp provider only (this lab's one supported model backend), per the P2b plan.
"""LLM factory — llama.cpp only.

This lab's sidecar supports exactly one provider: llama.cpp's llama-server
(OpenAI-compatible /v1 API with native tool-calling). The base URL comes from
this lab's own AIDEMO_BRAIN_URL (default empty: no model call, the lab stays on
the Scripted brain). The lab never assumes port 8090 and never uses AI-DEMO2's
llm-proxy container.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)


def get_llm(
    provider: str = "llamacpp",
    model: Optional[str] = None,
    temperature: float = 0.2,
    # 1000 was too low for a reasoning model: gpt-oss-20b spends most of its budget
    # on reasoning before emitting any visible answer (measured in AI-DEMO2: an
    # open-ended prompt burned all 1000 tokens on reasoning and returned
    # finish_reason='length' with EMPTY content). 3000 matches the source repo's
    # raised value for exactly this reason.
    max_tokens: int = 3000,
    streaming: bool = True,
    llamacpp_base_url: str = "",
    llamacpp_model: str = "gpt-oss-20b",
    **kwargs: Any,
) -> Optional[BaseChatModel]:
    """Return a ChatOpenAI pointed at this lab's llama-server, or None when unset.

    Args:
        provider: only "llamacpp" is supported here; anything else (including
            "none" or an empty string) returns None so the caller falls back to
            the Scripted brain.
        llamacpp_base_url: this lab's AIDEMO_BRAIN_URL. Empty (the default) means
            no model is configured: return None and let the lab answer with the
            Scripted brain. The URL is the origin only; /v1 is appended here.
        llamacpp_model: default gpt-oss-20b, the model AI-DEMO2 runs with
            llama.cpp (owner decision 2026-11-10).
    """
    resolved = (provider or "none").lower()
    if resolved != "llamacpp" or not llamacpp_base_url:
        logger.info("LLM provider=%s url=%s — no model call (Scripted brain stays)", provider, llamacpp_base_url or "(unset)")
        return None
    # 127.0.0.1, not localhost — clients can resolve localhost to ::1 where
    # llama-server is not bound (carried over from the source repo).
    base = llamacpp_base_url.rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    resolved_model = model or llamacpp_model
    logger.info("Initializing LLM: provider=llamacpp model=%s url=%s", resolved_model, base)
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=resolved_model,
        openai_api_base=base,
        openai_api_key="llama-cpp",  # llama-server ignores the key; the client requires one
        temperature=temperature,
        max_tokens=max_tokens,
        # At the ~44 tok/s worst case measured locally a full 3000-token generation
        # outlives the client's 60s default (carried over from the source repo).
        request_timeout=float(os.getenv("AIDEMO_BRAIN_TIMEOUT", "240")),
        streaming=streaming,
    )
