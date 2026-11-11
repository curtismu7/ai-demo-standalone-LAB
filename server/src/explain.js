// The teaching layer: for one run, WHAT is going on (per stage), the LESSON, and the TECH
// PROOF — the mock HTTP exchanges (request/response text, W3C traceparent) a colleague can
// read to see the mechanics. Values are mock; hosts end in .example; no credential material.
import { randomBytes } from 'node:crypto';

const TP32 = /^[0-9a-f]{32}$/;
export function newTrace(incoming) {
  if (typeof incoming === 'string' && incoming.startsWith('00-')) {
    const parts = incoming.split('-');
    if (parts.length === 4 && TP32.test(parts[1]) && parts[2].length === 16) {
      return { traceId: parts[1], span: () => randomBytes(8).toString('hex') };
    }
  }
  return { traceId: randomBytes(16).toString('hex'), span: () => randomBytes(8).toString('hex') };
}
const tp = (traceId, spanId) => `00-${traceId}-${spanId}-01`;

/** The product at each stage (the lab's mock stands in for the real product). */
export const STAGE_PRODUCTS = {
  protocol: 'PingFederate / the API edge',
  token: 'PingFederate (token validation)',
  gateway: 'PingGateway (the gateway enforcing the chain)',
  policy: 'PingOne Authorize (the PDP)',
  dispatch: 'the protected API / MCP resource server',
};

/** Which product plays which role, for one outcome. */
export function productCast(verdict) {
  return [
    { product: 'PingFederate', role: 'IdP', does: 'authenticated the user and minted the delegated token (sub = human, act = actor)' },
    { product: 'PingGateway', role: 'gateway / PEP', does: `validated the delegation chain${verdict.stage === 'gateway' ? ' and REFUSED the call here' : ', then passed it to the PDP'}` },
    { product: 'PingOne Authorize', role: 'PDP', does: verdict.stage === 'policy' ? `evaluated groups, tier, tool and amount, and returned ${verdict.decision}` : 'did not run (the gateway refused first)' },
    { product: 'the protected API / MCP server', role: 'resource', does: verdict.decision === 'PERMIT' ? 'dispatched the tool call, fully attributable' : 'never saw the call' },
  ];
}

/** Per-stage narrative: what just happened and why it matters. */
export function explain(verdict, { user, actor, tool, amount, groups, tier, audience }) {
  const acting = actor ? `${actor} (acting for ${user})` : user;
  const product = (code) => STAGE_PRODUCTS[code] || '';
  const perStage = {
    protocol: [
      { stage: 'protocol', title: `No token, no conversation (${product('protocol')})`, what: `The call arrived with no bearer token. The API answers 401 with a WWW-Authenticate header BEFORE anything else — no policy runs, nothing leaks. This is the protocol doing its job.` },
    ],
    token: [
      { stage: 'token', title: `The token itself failed (${product('token')})`, what: `The gateway read the token and refused it (${verdict.code}). ${verdict.code === 'upstream_audience' ? 'The aud claim names an upstream MCP server — a token minted for one destination is never accepted at another. An audience is a destination.' : 'A malformed or expired token never reaches the policy layer.'}` },
    ],
    gateway: [
      { stage: 'gateway', title: `The delegation chain was refused (${product('gateway')})`, what: verdict.code === 'unauthorized_actor'
        ? `The token says ${acting}. "${actor}" is not on the actor allow-list, so the gateway refuses the call before any policy runs. Authorization keys on WHO is acting — a stolen-but-valid user token cannot be used by an unknown agent.`
        : `The gateway could not validate the delegation chain (${verdict.code}).` },
    ],
    policy: verdict.decision === 'PERMIT' ? [
      { stage: 'policy', title: `The policy checked three things (${product('policy')})`, what: `1) Groups: ${user} is in [ ${(groups || []).join(', ') || 'none'} ] — the required group gate passed. 2) Tools: "${tool}" is allowed for tier ${tier}. 3) Amounts: ${amount != null ? `$${amount} is inside the ${tier} band.` : 'no amount to check.'} All three passed: PERMIT, and the dispatched call is fully attributable to a real human.` },
    ] : [
      { stage: 'policy', title: `The policy said no (${product('policy')})`, what: verdict.code === 'group_entitlement'
        ? `${user} is in [ ${(groups || []).join(', ') || 'none'} ] — outside the required group. The policy denies REGARDLESS of the token's scopes: scopes say what the token may ask for, groups say who may ask at all. This is why directory-driven access beats scope-driven access.`
        : verdict.code === 'tier_tool_not_allowed'
        ? `"${tool}" is a premium-only tool and ${user}'s tier is ${tier}. Positive least privilege: restricted tools are LISTED in policy, never implied by scopes. The user's other permissions are unaffected.`
        : verdict.code === 'tier_amount_exceeded'
        ? `$${amount} exceeds the ${tier} ceiling. Tiers are amount BANDS in policy, not tool arguments — the same tool call flips on the tier, not on what the client asks for.`
        : verdict.reason },
    ],
  };
  if (verdict.decision === 'OBLIGATION' && OBLIGATION_EXPLAIN[verdict.code]) return [OBLIGATION_EXPLAIN[verdict.code]];
  return perStage[verdict.stage] || perStage.policy;
}

const OBLIGATION_EXPLAIN = {
  CONFIRM: { stage: 'policy', title: 'The policy paused the call (CONFIRM)', what: 'The amount clears the confirm threshold ($250): the agent must pause and surface a consent modal. Explicit consent only — no MFA at this band. A receipt with ConsentGiven re-evaluates the SAME call to PERMIT.' },
  STEP_UP: { stage: 'policy', title: 'The policy paused the call (STEP_UP)', what: 'The amount clears the step-up threshold ($500) but not the deny ceiling: consent + MFA. The agent PAUSES — it cannot proceed, cannot substitute, cannot self-approve. The human completes MFA and the receipt (MfaVerified) re-evaluates the call.' },
  HITL_CONSENT: { stage: 'policy', title: 'The policy paused the call (HITL)', what: 'This tool always requires human approval regardless of amount. The agent pauses and surfaces a consent modal; only a verified HitlApproved receipt (bound to this exact call) re-evaluates it. An approval is never an MFA, and an MFA is never an approval.' },
  CIBA: { stage: 'policy', title: 'The policy paused the call (CIBA)', what: 'An agent is acting with no browser in which to prompt. The backend calls bc-authorize; the user approves OUT-OF-BAND on their enrolled device; the receipt (CibaApproved) re-evaluates the call. This is decoupled approval for agent-initiated money movement.' },
};

/** The lesson in one sentence, per outcome. */
export function lessonFor(verdict, { user, actor, tool }) {
  if (verdict.decision === 'OBLIGATION') {
    return { CONFIRM: 'Mid-band amounts ask for explicit consent only: the agent pauses, the human taps, the same call re-evaluates.',
      STEP_UP: 'Step-up is a pause, not a denial: the agent cannot self-approve; the human completes MFA and the bound receipt re-evaluates the call.',
      HITL_CONSENT: 'Human-approval tools always pause the agent: only a verified, call-bound HitlApproved receipt moves it — an approval is never an MFA.',
      CIBA: 'Agents have no browser: CIBA requests decoupled approval on the user\u2019s device, and the receipt re-evaluates the call.' }[verdict.code] || 'The policy paused the call: an obligation is a pause the human resolves, not a denial.';
  }
  if (verdict.stage === 'protocol') return 'A missing token is a protocol answer (401), not an authorization answer: fail closed, say nothing, point at the auth scheme.';
  if (verdict.code === 'unauthorized_actor') return 'WHO is acting is an authorization question: the actor allow-list refuses unknown agents before any policy runs.';
  if (verdict.code === 'upstream_audience') return 'An audience is a destination: tokens are accepted only at the audience they were minted for.';
  if (verdict.code === 'group_entitlement') return 'Directory groups are read on EVERY decision — scopes cannot override them. Flip the group and the very next call moves.';
  if (verdict.code === 'tier_tool_not_allowed') return 'Positive least privilege: premium tools are listed in policy, never implied by scopes.';
  if (verdict.code === 'tier_amount_exceeded') return 'Tiers are amount bands: the same call flips on the tier, not on client arguments.';
  return `PERMIT is only ever as wide as the chain behind it: ${actor || user} acted, the group gate passed, and every hop is attributable.`;
}

/** The mock HTTP exchanges behind one run, with raw request/response text + traceparent. */
export function buildHops({ verdict, user, actor, tool, amount, token, trace, aud, consent }) {
  const host = 'api.northwind.example';
  const id = () => trace.span();
  const hops = [];
  if (consent) {
    const s1 = id();
    hops.push({
      n: hops.length + 1, label: 'PingFederate: consent — the user approves; a delegated token is minted', traceparent: tp(trace.traceId, s1),
      request: `POST https://idp.${'northwind'}.example/as/token.oauth2\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\nsubject_token=<user session>\nactor_client_id=${actor || user}\n\n(user consented once — this exchange is the ONLY place act= is minted)`,
      response: `HTTP/1.1 200 OK\n{\n  "sub": "${user}",\n  "act": { "sub": "${actor || user}" },\n  "aud": "${aud || 'ai-demo-standalone'}",\n  "exp": 3600\n}\n\nsub is the HUMAN; act names the actor. Every later hop traces back here.`,
    });
  }
  const s2 = id();
  const authLine = token ? `Authorization: Bearer eyJ... (sub=${user}${actor ? `, act={${actor}}` : ''})` : '(no Authorization header)';
  hops.push({
    n: hops.length + 1, label: 'The gated call reaches the API (PingGateway fronting the resource)', traceparent: tp(trace.traceId, s2),
    request: `POST https://${host}/api/authorize\n${authLine}\ncontent-type: application/json\n\n{ "tool": "${tool}"${amount != null ? `, "amount": ${amount}` : ''} }`,
    response: verdict.stage === 'protocol'
      ? `HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer realm="ai-demo-standalone", error="invalid_request"\n\n(no body worth reading: nothing was evaluated)`
      : `(held for the verdict — the response hop is last)`,
  });
  if (verdict.stage !== 'protocol') {
    const s3 = id();
    hops.push({
      n: hops.length + 1, label: 'PingGateway: the delegation chain is validated', traceparent: tp(trace.traceId, s3),
      request: `validateToken(sub=${user}, aud=${aud || 'ai-demo-standalone'}, exp=ok)\nvalidateChain(act=${actor ? `{${actor}}` : '(none)'} — allow-list check)`,
      response: verdict.stage === 'gateway'
        ? `REFUSED: ${verdict.code}\n${verdict.reason}\n\n(the policy never ran)`
        : `chain valid${actor ? `: ${actor} is on the actor allow-list` : ': user acting directly'}`,
    });
  }
  if (verdict.stage === 'policy') {
    const s4 = id();
    hops.push({
      n: hops.length + 1, label: 'PingOne Authorize: groups, tier, tool, amount', traceparent: tp(trace.traceId, s4),
      request: `evaluatePolicy(groups=<live directory>, tier, tool="${tool}"${amount != null ? `, amount=${amount}` : ''})`,
      response: verdict.decision === 'PERMIT' ? `PERMIT\n(the tool dispatches; every hop above is in the trace)` : `DENY: ${verdict.code}\n${verdict.reason}`,
    });
  }
  const last = id();
  hops.push({
    n: hops.length + 1, label: verdict.decision === 'PERMIT' ? 'Response: the call executed, fully attributable' : 'Response: refused, nothing executed', traceparent: tp(trace.traceId, last),
    request: `(the API answers the caller)`,
    response: verdict.decision === 'PERMIT'
      ? `HTTP/1.1 200 OK\n{ "decision": "PERMIT", "who": "${actor ? `${actor} acting for ${user}` : user}", "tool": "${tool}" }`
      : verdict.decision === 'OBLIGATION'
      ? `HTTP/1.1 202 Accepted\n{ "decision": "OBLIGATION", "obligation": "${verdict.code}" }\n\n(the agent pauses; the human resolves it; the receipt re-evaluates)`
      : `HTTP/1.1 403 Forbidden\n{ "decision": "DENY", "code": "${verdict.code}" }`,
  });
  return hops;
}
