// The Scripted brain (plan phase P2): match what the visitor typed to ONE handling —
// an in-app scenario (the 11 the engine runs), a redirect to a standalone lab (the 45
// from Appendix A), or unknown. Regex-first, exactly like the dashboard's default
// mode ("heuristics": regex first, an LLM only if the regex fails). The model brain
// (P2b, opt-in) replaces ONLY this matcher: it returns the same { handling, id } shape,
// and the reply is always written from the run (or the redirect card), never by the model.
//
// Every in-app match carries the scenario's expected outcome; the server re-checks the
// scenario id against the SCENARIOS table, so a model-invented id is refused (same rule
// as the customer-agent lab's brain.js). Amounts typed in the message ride along: the
// engine bands the amount, the message never overrides a scenario's own amount.

import { SCENARIOS } from './policyData.js';

// The 45 redirect targets (Appendix A, owner decision 2026-11-10: 31 in-app, 45 redirect, 11 guide).
// Lab names are shelf folder names without -LAB (the UI resolves them against the shelf).
export const REDIRECTS = {
  UC23: 'progressive-trust-ladder', UC12: 'stolen-token-lab', UC14: 'intent-par-inspector',
  UC14b: 'intent-par-inspector', UC15: 'intent-par-inspector', UC16: 'obo-lab',
  UC17: 'jit-lab', UC18: 'agent-kill-switch', UC30: 'mcp-gateway-lab', UC31: 'mcp-gateway-lab',
  'UC-TOOL3': 'gateway-suite-lab', UC46: 'privilege-a2a-anthropic-demo', UC46A: 'privilege-a2a-anthropic-demo',
  UC47: 'privilege-a2a-anthropic-demo', 'UC-MUSE1': 'muse', 'UC-MUSE2': 'muse',
  'UC-NHI1': 'agent-governance-lab', 'UC-NHI2': 'agent-registry-demo', 'UC-LEARN2': 'pingone-mcp-inspector',
  'UC-LEARN3': 'mcp-tools', 'UC-LEARN4': 'mcp-tools', 'UC-LEARN6': 'token-workbench',
  'UC-LEARN8': 'id-jag-standalone', 'UC-LEARN9': 'id-jag-standalone', 'UC-LEARN12': 'pingfederate',
  'UC-LEARN13': 'pingfederate', 'UC-LEARN14': 'ciba-hitl-lab', 'UC-LEARN15': 'jev-lab',
  'UC-LEARN11': 'ai-guard-sidecar', 'UC-LEARN16': 'pingone-signin', 'UC-LEARN17': 'token-workbench',
  'UC-LEARN19': 'intent-par-inspector', UC25: 'id-jag-standalone', UC39: 'agent-kill-switch',
  UC40: 'id-jag-standalone', 'UC-LOGIN': 'pingone-signin', 'UC-LOGIN-PF': 'pingfederate',
  'UC-OBO': 'obo-lab', UC28: 'no-tool-no-promise', UC37: 'a2a-lab', UC38: 'worker-demo',
  UC43: 'cimd', UC44: 'obo-lab', UC45: 'worker-demo', UC48: 'muse',
};

const clean = (s) => String(s ?? '').slice(0, 300).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();

// An amount typed in the message: "refund $300", "600 dollars", "1,200". The engine bands it.
export function amountIn(text) {
  const m = /(?:\$|usd\s*)?([0-9][0-9,]{0,9})(?:\.\d{1,2})?\s*(?:dollars|usd|bucks)?\b/i.exec(String(text ?? '').replace(/,/g, ''));
  return m ? Number(m[1]) : null;
}

// The matcher table. First match wins; order matters (specific phrases before generic ones).
// Each row: [regex, handling, id]. In-app ids are scenario ids; redirect ids are catalog ids.
const RULES = [
  // P6 batch 3: the HITL bypass attempt — specific before the generic HITL rows
  [/consent (was )?already given|bypass (the )?(hitl|consent|approval)|skip (the )?(hitl|consent|approval)|forged approval|already approved|consentgiven/i, 'in-app', 'uc27-bypass'],
  // HITL: step-up, approval, CIBA — the teaching core
  [/mfa|step[- ]?up|two[- ]?factor|otp|verification code/i, 'in-app', 'uc7-stepup'],
  [/human (approval|in the loop)|hitl|approv(e|al) (a )?(transfer|payment|action)|manager approv/i, 'in-app', 'uc8-hitl'],
  [/\bciba\b|out[- ]of[- ]band|approv(e|al) (on )?(my|the) (phone|device)|push notification/i, 'in-app', 'uc22-ciba'],
  // Controls
  [/not in the (required )?group|group (check|gate|membership)|entitlement check|required group|in the group/i, 'in-app', 'uc9'],
  [/flip (the )?directory|change (the )?group|revoke.{0,20}privileged|directory (entry|flip)/i, 'in-app', 'uc9a'],
  [/premium (tool|wire|tier)|tier.{0,20}(premium|standard)|standard tier/i, 'in-app', 'uc21-tool'],
  [/promote.{0,20}premium|upgrade.{0,20}(tier|premium)|premium now/i, 'in-app', 'uc21-promote'],
  [/(60000|\$?60,?000)|exceeds.{0,20}ceiling|over.{0,20}ceiling/i, 'in-app', 'uc21-ceiling'],
  // Foundations
  [/consent|delegat(e|ion|ed) (token|access)|act claim|on behalf of me|check (my )?balance|balance read/i, 'in-app', 'uc1'],
  [/unknown agent|rogue agent|unregister(ed|ed) agent|agent not (registered|allowed)/i, 'in-app', 'uc6-rogue'],
  [/upstream (mcp|audience)|token (aimed|minted) (at|for) (the )?upstream/i, 'in-app', 'uc32-upstream'],
  // P6 batch 1 (foundations): act gate, agent identity lifecycle, observability, mortgage, patterns, why-blocked
  [/act gate|may[- ]act|revok(e|ed).{0,40}(consent|authorization|agent)|delegat(e|ion|ed).{0,20}consent.{0,20}(every|each|per) call/i, 'in-app', 'uc3-actgate'],
  [/agent (identity|app).{0,30}(lifecycle|retire|rotate)|retire(d)? (the )?agent|orphaned agent|rotate (the )?agent credential|live agent identity|agent.{0,10}identity.{0,20}exchange/i, 'in-app', 'uc19-lifecycle'],
  [/agent (observability|audit|trace)|traceab(le|ility)|reconstruct.{0,20}trace|full trace|audit trail/i, 'in-app', 'uc20-trace'],
  [/my mortgage|mortgage (lookup|read|status|balance|details)|show.{0,10}mortgage/i, 'in-app', 'uc33-mortgage'],
  [/unusual pattern|odd (activity|behavior|behaviour)|anomal(y|ies)|spot.{0,20}unusual|anything unusual/i, 'in-app', 'uc34-patterns'],
  [/why.{0,20}(was|is).{0,20}(that|it|this).{0,20}blocked|explain.{0,20}(the )?(block|denial|deny|refus)|why.{0,20}denied|walk me through.{0,20}token chain/i, 'in-app', 'uc35-why'],
  // P6 batch 2 (attacks): wrong scope, takeover, bad client, confused deputy, forwarding, outage
  [/wrong scope|insufficient scope|read[- ]scoped|scope enforcement|wrong[- ]ly scoped/i, 'in-app', 'uc5-scope'],
  [/account takeover|another user'?s account|someone else'?s account|cross[- ]owner|resource[- ]ownership|read.{0,20}other.{0,10}account/i, 'in-app', 'uc10-takeover'],
  [/bad client|wrong audience|token minted for (another|a different)|token for another api/i, 'in-app', 'uc11-badclient'],
  [/confused deputy|forged.{0,20}(actor|header)|actor injection|header.{0,20}(actor|acting)|forged.{0,20}acting|acting[- ]for header/i, 'in-app', 'uc13-deputy'],
  [/raw (user )?token|forward(ed|ing).{0,20}token|token forwarding|zero trust/i, 'in-app', 'uc16b-forward'],
  [/validation (outage|down|unavailable)|fail[- ]closed|fails closed|outage|down.{0,30}(what happens|happens to)/i, 'in-app', 'uc29-outage'],
  // P6 batch 3 (final): overscoped agent, gateway-filtered search, public catalog, live verdict, HITL bypass
  [/overscop(e|ed)|over[- ]privileged|least[- ]privilege|asks? for write.{0,30}(only )?need(s)? read|too much scope|scope bloat/i, 'in-app', 'uc4-overscoped'],
  [/blocked (query|search|term)|content blocklist|blocklist|bitcoin|cryptocurrency|crypto.{0,20}search|search.{0,30}(bitcoin|blocked)/i, 'in-app', 'uc42-search-blocked'],
  [/(third[- ]party|news|web) search|brave search|search the news|search the web for|search server/i, 'in-app', 'uc41-search'],
  [/branch (hours|near)|public catalog|before (i|we) sign|without signing in|browse.{0,20}(without|before)|act 1/i, 'in-app', 'uc24-public'],
  [/proof of enforcement|live verdict|watch the verdict|take (your|the) (agent'?s? )?word|watch.{0,20}decid/i, 'in-app', 'uc26-proof'],
  // Redirects: the standalone labs that own these stories
  [/token (theft|replay)|stolen (token|session)|replay (attack|defense)/i, 'redirect', 'UC12'],
  [/\bjit\b|just[- ]in[- ]time (access|provision)/i, 'redirect', 'UC17'],
  [/kill switch|emergency (revoke|revoke access)|immediately revoke/i, 'redirect', 'UC18'],
  [/par\b|intent.{0,10}par|parameterized auth/i, 'redirect', 'UC14'],
  [/\bobo\b|on[- ]behalf[- ]of (flow|lab)|delegation (depth|chain) (limit|lab)/i, 'redirect', 'UC16'],
  [/progressive trust|trust ladder/i, 'redirect', 'UC23'],
  [/pingfederate (sign|login)|pf (sign|login)|sso with pingfederate/i, 'redirect', 'UC-LOGIN-PF'],
  [/pingone (sign|login)|hosted login page/i, 'redirect', 'UC-LOGIN'],
  [/passkey|webauthn|fido/i, 'redirect', 'UC-LEARN16'],
  [/jev\b|justification.{0,20}(evidence|view)/i, 'redirect', 'UC-LEARN15'],
  [/ciba.{0,20}lab|ciba hitl/i, 'redirect', 'UC-LEARN14'],
  [/id[- ]?jag|identity assertion jwt/i, 'redirect', 'UC-LEARN8'],
  [/token workbench|decode.{0,10}token|inspect.{0,10}token/i, 'redirect', 'UC-LEARN6'],
  [/mcp (inspector|tools)/i, 'redirect', 'UC-LEARN3'],
  [/agent (governance|registry|kill)/i, 'redirect', 'UC-NHI1'],
  [/\bmuse\b|external agent.{0,20}gateway/i, 'redirect', 'UC-MUSE1'],
  [/no tool,? no promise|no[- ]tool/i, 'redirect', 'UC28'],
  [/worker (demo|agent)/i, 'redirect', 'UC38'],
  [/\bcimd\b|client[- ]initiated metadata/i, 'redirect', 'UC43'],
  [/gateway suite|gateway claims/i, 'redirect', 'UC-TOOL3'],
];

// Match what the visitor typed. Returns:
//   { handling: 'in-app',  scenarioId, ucId, amount }   — run the engine scenario
//   { handling: 'redirect', ucId, lab }                 — open the standalone lab
//   { handling: 'unknown' }                             — the honest "I did not match that" reply
export function matchTurn(said) {
  const text = clean(said);
  if (!text) return { handling: 'unknown' };
  for (const [re, handling, id] of RULES) {
    if (re.test(text)) {
      if (handling === 'in-app') {
        const scenario = SCENARIOS.find((s) => s.id === id);
        if (!scenario) continue; // a table drift can never crash the turn: skip the row
        const amount = amountIn(text) ?? scenario.amount;
        return { handling, scenarioId: scenario.id, ucId: scenario.ucId, amount, title: scenario.title };
      }
      const lab = REDIRECTS[id];
      if (!lab) continue;
      return { handling, ucId: id, lab };
    }
  }
  return { handling: 'unknown' };
}
