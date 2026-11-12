# Provenance

Files copied from other repositories into this one, with their licences and the
changes made here. THE COPY RULE (this repo's README): reuse means copy into
this repo, never reference another repo at run time.

## `brain/` — copied from AI-DEMO2 `langchain_agent/` (MIT)

AI-DEMO2's `langchain_agent/` directory carries the MIT licence notice of its
origin project; the files below were copied on 2026-11-12 from
`curtismu7/AI-DEMO2@origin/main` and adapted for this lab. Nothing imports or
fetches from AI-DEMO2 at run time; the `no-ai-demo2` gate (`scripts/no-ai-demo2.test.mjs`)
enforces that.

| File here | From there | Change |
|---|---|---|
| `brain/src/agui/event_types.py` | `langchain_agent/src/agui/event_types.py` | none (byte copy) |
| `brain/src/agui/emitter.py` | `langchain_agent/src/agui/emitter.py` | none (byte copy) |
| `brain/src/agui/sse_transport.py` | `langchain_agent/src/agui/sse_transport.py` | none (byte copy) |
| `brain/src/agui/bff_tool_adapter.py` | `langchain_agent/src/agui/bff_tool_adapter.py` | header note; allowed hosts are this lab's service names (the source's AI-DEMO2 hosts removed); `build_bff_tools` gained `extra_tools`/`bff_internal_secret` parameters; the dev-default shared secret removed (this lab passes its per-boot secret explicitly) |
| `brain/src/agui_run_handler.py` | `langchain_agent/src/api/agui_run_handler.py` | header note; metrics import stubbed; the default tool URL is this lab's route; the processor call is `BrainProcessor.process_run` (no per-run provider override, no vertical flavor, no user identity) |
| `brain/src/message_processor.py` | `langchain_agent/src/api/message_processor.py` | ONLY the BFF-tool branch: the streaming core (`astream_events` text/tool routing), the deterministic policy-denial fallback, the no-visible-output guard and the pre-model token trim; the MCP graph path, guardrails, Opik, Helix and per-run provider overrides are cut; the system prompt is this lab's own |
| `brain/src/llm_factory.py` | `langchain_agent/src/agent/llm_factory.py` | cut to the llamacpp provider only; the URL comes from this lab's `AIDEMO_BRAIN_URL` (empty default = no model call); model default gpt-oss-20b |
| `brain/src/metrics.py` | `langchain_agent/src/metrics.py` | reduced to in-process counters (no OpenTelemetry/Prometheus in this lab) |
| `brain/tests/test_brain.py` | pattern from the spike (see below) | new |

New code written for this lab (not copied): `brain/src/engine_tools.py` (the lab
tool-route client), `brain/src/app.py` (entrypoint), `brain/Dockerfile`,
`brain/README.md`, `server/src/brain.js`, the tool route in `server/src/app.js`,
and the tests around them.

## CI waiver (owner decision 2026-11-10)

The lab is Node-26-only, but the brain sidecar is literal Python (LangChain/LangGraph,
owner-confirmed Option A). Its CI job (`brain`) runs on a GitHub-hosted runner with
pinned Python 3.12 and pinned package versions; it executes the sidecar's pytest suite
with a scripted tool-calling ChatModel — no live LLM, no network.
