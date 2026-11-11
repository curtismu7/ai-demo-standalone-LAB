// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as
// X-Workspace on every API call that touches server state. A workspace id is NOT a credential:
// the server mints an HMAC workspace token (GET /api/workspace) that this module also keeps in
// sessionStorage and sends as X-Workspace-Token on every call. The server refuses stateful
// calls whose id+token pair does not verify.
const KEY = "gcl.workspace";
const TKEY = "gcl.workspace.token";
let memo = null;
let memoToken = null;
let mintPromise = null;

function randomId() {
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && /^[a-z0-9-]{1,40}$/.test(saved)) return (memo = saved); } catch { /* blocked */ }
  memo = randomId();
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

/** The workspace token, minted once per tab (re-minted after a server restart refuses it). */
export async function workspaceToken() {
  if (memoToken) return memoToken;
  if (mintPromise) return mintPromise;
  mintPromise = (async () => {
    // cached token first: the server only refuses it if its key rotated (restart without
    // AIDEMOLAB_SERVER_KEY), in which case we re-mint below
    try { const saved = window.sessionStorage.getItem(TKEY); if (saved) { memoToken = saved; return saved; } } catch { /* blocked */ }
    const r = await fetch("/api/workspace", { headers: { "x-workspace": workspaceId() } });
    const j = await r.json();
    if (!j.token) throw new Error("workspace token mint failed");
    memoToken = j.token;
    try { window.sessionStorage.setItem(TKEY, j.token); } catch { /* blocked */ }
    return j.token;
  })();
  return mintPromise;
}

/** A 401 workspace_token_required clears the cached token so the next call re-mints. */
export function invalidateWorkspaceToken() {
  memoToken = null;
  try { window.sessionStorage.removeItem(TKEY); } catch { /* blocked */ }
  mintPromise = null;
}

export const workspaceFetch = async (url, opts = {}, retry = true) => {
  const token = await workspaceToken();
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId(), "x-workspace-token": token } });
  if (r.status === 401 && retry) {
    invalidateWorkspaceToken();
    return workspaceFetch(url, opts, false);
  }
  return r;
};
