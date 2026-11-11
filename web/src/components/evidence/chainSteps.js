// P3 (lab-own): derive the 10 chain-map steps from a run's demo-hop/1 hops — the same
// fixed step list the server's hops.js CHAIN_STEPS defines, mirrored client-side so the
// map works from any run payload. State per step: ok | deny | held | not-in-run.
// The Detailed | Compact density choice persists here too (try/catch: a throwing
// localStorage never blocks the page; the write happens only on a user action).
const DENSITY_KEY = "ud_chain_density";

export function readDensity() {
  try { return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "detailed"; }
  catch { return "detailed"; }
}
export function writeDensity(v) {
  try { window.localStorage.setItem(DENSITY_KEY, v); } catch { /* private mode: this page only */ }
}

const STEPS = [
  { n: 1, id: "signin", label: "Sign-in", kinds: ["sign-in"] },
  { n: 2, id: "prompt", label: "Prompt", kinds: ["prompt"] },
  { n: 3, id: "agent", label: "Agent", kinds: ["agent-receive"] },
  { n: 4, id: "llm", label: "LLM", kinds: ["llm-plan"] },
  { n: 5, id: "agent-token", label: "Agent token", kinds: ["actor-token"] },
  { n: 6, id: "exchange", label: "Exchange", kinds: ["token-exchange"] },
  { n: 7, id: "authorize", label: "Authorize", kinds: ["authorize-decision"] },
  { n: 8, id: "gateway", label: "Gateway", kinds: ["gateway-check"] },
  { n: 9, id: "tool", label: "MCP tool", kinds: ["tool-dispatched", "tool-refused", "tool-held"] },
  { n: 10, id: "reply", label: "Reply", kinds: ["agent-reply"] },
];

export function deriveChainSteps(hops = []) {
  return STEPS.map((s) => {
    const hop = hops.find((h) => s.kinds.includes(h.kind));
    const state = !hop || hop.verdict === "skip" ? "not-in-run"
      : hop.verdict === "ok" ? "ok"
      : hop.verdict === "deny" ? "deny"
      : "held";
    return { ...s, state, hopN: hop?.n ?? null };
  });
}
