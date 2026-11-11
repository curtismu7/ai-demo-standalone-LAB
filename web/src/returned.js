// Resume: the use case the visitor ran before handing off comes Back with them. On a load
// with a valid ?returned=<known app>&uc=<id> the dashboard routes to the Use Cases page with
// that use case preselected (the same entry the launcher's "Runs here" takes, minus the auto
// run: the visitor has already seen this run once). A plain load or reload starts fresh.
// The query carries ids only; both are checked before anything is shown, and the parameters
// are always removed from the address bar (history.replaceState). Nothing else about the
// session is stored — this lab has no chat state to keep (the dashboard transcript is
// component-local), so there is no sessionStorage resume here, only the return select.

const ID = /^[A-Za-z0-9.-]{1,40}$/;
const isId = (v) => typeof v === "string" && ID.test(v);

// The apps this lab hands off to (server/src/usecases.js PROXY_PATHS; ids only, same list).
export const HANDOFF_APPS = Object.freeze([
  'a2a-lab', 'agent-audit-trail', 'agent-governance-lab', 'agent-kill-switch', 'agent-registry-demo',
  'ai-guard-sidecar', 'ciba-hitl-lab', 'cimd', 'delegation-lab', 'gateway-suite-lab', 'hitl-mfa-lab',
  'id-jag-standalone', 'intent-par-inspector', 'jev-lab', 'jit-lab', 'mcp-gateway-lab', 'mcp-tools',
  'meridian-a2a-hop', 'mock-authorize', 'muse', 'no-tool-no-promise', 'obo-lab', 'pingfederate',
  'pingone-mcp-inspector', 'pingone-signin', 'privilege-a2a-anthropic-demo', 'progressive-trust-ladder',
  'stolen-token-lab', 'token-workbench', 'worker-demo',
]);

// ?returned=<app>&uc=<id>: the visitor came Back from another app. Returns { app, uc } when
// both are ids and the app is one this page hands off to, else null. Always removes the two
// parameters from the address bar, keeping the path, other params and hash.
export function takeReturn() {
  let q;
  try { q = new URLSearchParams(window.location.search); } catch { return null; }
  // Strip only when a `returned` names this lab as the Back target; a bare `uc` (which the
  // ?from=customer-agent hand-off also carries) belongs to that flow and must stay alone.
  if (!q.has("returned")) return null;
  const app = q.getAll("returned").length === 1 ? q.get("returned") : null;
  const uc = q.getAll("uc").length === 1 ? q.get("uc") : null;
  q.delete("returned"); q.delete("uc");
  try {
    const rest = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  } catch { /* ignore */ }
  return isId(app) && isId(uc) && HANDOFF_APPS.includes(app) ? { app, uc } : null;
}
