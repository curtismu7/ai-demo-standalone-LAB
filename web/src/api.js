import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// POST /api/mode: the rule 19 Mock/Real toggle. 409 when Real is not configured.
export async function setMode(source) {
  const r = await workspaceFetch("/api/mode", { method: "POST", body: JSON.stringify({ source }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// GET /api/catalog: all use cases, filterable by track.
export const getCatalog = (track) => getJson(`/api/catalog${track ? `?track=${encodeURIComponent(track)}` : ""}`);

// POST /api/consent: mint the delegated token (mock). 401/403 are DATA, not errors.
export async function consent(payload) {
  const r = await workspaceFetch("/api/consent", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// POST /api/authorize: one gated call through the mock PDP.
export async function authorize(payload) {
  const r = await workspaceFetch("/api/authorize", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// The live directory board.
export const getDirectory = () => getJson("/api/directory");
export async function setDirectory(payload) {
  const r = await workspaceFetch("/api/directory/set", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);

// POST /api/assistant/turn: the one-page dashboard's assistant. Returns
// { handling, reply: { text, by, outcome, ucId?, tool? }, run?, hops?, ucId?, lab? }.
export async function assistantTurn(message) {
  const r = await workspaceFetch("/api/assistant/turn", { method: "POST", body: JSON.stringify({ message }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// GET /api/assistant/brain: whether the LangGraph sidecar is configured (P2b).
export async function assistantBrainInfo() {
  const r = await workspaceFetch("/api/assistant/brain");
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, body };
}

// POST /api/assistant/turn with brain=langgraph: the same turn, planned by the brain
// sidecar. The sidecar answers AG-UI SSE; this reads the stream and folds it into the
// SAME shape assistantTurn returns ({ handling, reply: { text, by, outcome }, run? }).
// The fold is client-side because the engine run is NOT re-executed here: the brain's
// tool calls already went through /api/assistant/tool (same engine), and this lab's
// evidence views render from the folded reply. On any sidecar failure the caller
// falls back to assistantTurn (Scripted) — never a broken page.
export async function assistantBrainTurn(message) {
  const r = await workspaceFetch("/api/assistant/turn", { method: "POST", body: JSON.stringify({ message, brain: "langgraph" }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// ── Stage 2: HITL + A2A ──────────────────────────────────────────────────────
export async function challenge(payload) {
  const r = await workspaceFetch("/api/challenge", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export async function answerChallenge(payload) {
  const r = await workspaceFetch("/api/challenge/answer", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export const a2aExchangeOne = (payload) => workspaceFetch("/api/a2a/exchange/one", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.json());
export const a2aExchangeTwo = (payload) => workspaceFetch("/api/a2a/exchange/two", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.json());
export async function a2aTool(payload) {
  const r = await workspaceFetch("/api/a2a/tool", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export const a2aRegistry = () => getJson("/api/a2a/registry");
export const a2aRegistrySet = (payload) => workspaceFetch("/api/a2a/registry/set", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.json());

// ── Stage 3: the attack gallery ─────────────────────────────────────────────
export const getAttacks = () => getJson("/api/attacks");
export async function runAttack(payload) {
  const r = await workspaceFetch("/api/attacks/run", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// ── Stage 4: NHI (agent identity lifecycle) ─────────────────────────────────
export const getRoster = () => getJson("/api/nhi/roster");
export async function nhiRegister(payload) {
  const r = await workspaceFetch("/api/nhi/register", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export const nhiRotate = (agentId) => workspaceFetch("/api/nhi/rotate", { method: "POST", body: JSON.stringify({ agentId }) }).then((r) => r.json());
export const nhiRevoke = (agentId) => workspaceFetch("/api/nhi/revoke", { method: "POST", body: JSON.stringify({ agentId }) }).then((r) => r.json());
export const getJml = () => getJson("/api/nhi/jml");
export const getUseCases = (uc, app) => getJson(`/api/usecases${uc ? `?uc=${encodeURIComponent(uc)}${app ? `&app=${encodeURIComponent(app)}` : ""}` : ""}`);

// GET /api/runs: this workspace's audit trail (tool, decision, reason, blocked, ucId, at).
export const getRuns = () => getJson("/api/runs");

// POST /api/real-exchange: the real PingOne RFC 8693 exchange (third-party JWT as the actor token).
// 409 when Real is not configured; 400/401/403/502 carry PingOne's refusal as DATA.
export async function realExchange(payload) {
  const r = await workspaceFetch("/api/real-exchange", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// GET /api/info: mode + realAvailable (whether AIDEMOLAB_REAL_* is configured).
export const getInfo = () => getJson("/api/info");

// P10 Real sign-in (login only; data stays mock). GET /api/signin: availability + who is signed in.
export const getSignin = () => getJson("/api/signin");
// POST /api/signin {password}: the pi.flow ceremony on the server; the password is sent once, never stored.
export const postSignin = (password) => workspaceFetch("/api/signin", { method: "POST", body: JSON.stringify({ password }) });
// POST /api/signout: clear this workspace's Real session server-side.
export const postSignout = () => workspaceFetch("/api/signout", { method: "POST", body: JSON.stringify({}) });
