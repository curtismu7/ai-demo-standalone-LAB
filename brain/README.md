# The brain sidecar (P2b)

An optional LangGraph brain for the assistant: a local model (llama.cpp's
llama-server, e.g. gpt-oss-20b) chooses tools and amounts; every tool call is
executed by THIS lab's policy engine, never by the model.

- OFF by default: the compose service runs only under the `brain` profile
  (`docker compose --profile brain up`), publishes no host port, and the lab
  container never waits for it. With `AIDEMO_BRAIN_URL` unset the lab stays on
  the Scripted brain and no model call is ever made.
- Sources: copied from AI-DEMO2's langchain_agent (MIT) and cut to the BFF-tool
  branch — see `docs/PROVENANCE.md` in the repo root.
- Endpoints: `POST /run` (AG-UI SSE), `GET /health`.
- Settings: `AIDEMO_BRAIN_URL` (origin of your llama-server, e.g.
  `http://host.docker.internal:8096`), `AIDEMO_BRAIN_MODEL` (default
  gpt-oss-20b), `AIDEMOLAB_TOOL_URL` (the lab's tool route, compose-internal),
  `AIDEMOLAB_BRAIN_SECRET` (per-boot shared secret from the lab container).

Start your own model server (the lab downloads nothing):

    llama-server -m ~/models/gpt-oss-20b-mxfp4.gguf --port 8096 \
      --ctx-size 16384 --n-gpu-layers 33 --parallel 1 --jinja

then `HOST_PORT=7810 AIDEMO_BRAIN_URL=http://host.docker.internal:8096 docker compose --profile brain up --build -d`
and pick "LangGraph" in the lab's Demo Controls.
