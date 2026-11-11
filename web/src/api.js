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
