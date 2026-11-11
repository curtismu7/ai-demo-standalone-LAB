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
