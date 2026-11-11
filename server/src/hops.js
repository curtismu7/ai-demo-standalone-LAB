// P3: the demo-hop/1 adapter. Turns one engine run (the verdict from pdp.js plus the
// consent/exchange path) into the hops the vendored evidence screens (MovieReel,
// SequenceView, StepDetailPanel) draw, and into the raw MOCK token cards the Evidence
// section shows. Every emitted hop is enriched from the vendored hop catalog and must
// pass the vendored validateHop (hopDetail.mjs). Verdicts: ok | deny | held |
// obligation | skip; a skip hop carries NO traceparent and an empty request/response.
import catalog from './vendor/hop-catalog.json' with { type: 'json' };
import { enrichHop } from './vendor/hopDetail.mjs';

const IDP = 'https://idp.airline.example';
const BFF = 'https://bff.airline.example';
const GW = 'https://gateway.airline.example';
const MCP = 'https://mcp.airline.example';

// The 10 chain-map steps (the plan's fixed row). `kinds` are the catalog kinds each step
// can be answered by; the FIRST matching hop decides the step's state.
export const CHAIN_STEPS = [
  { n: 1, id: 'signin', label: 'Sign-in', kinds: ['sign-in'] },
  { n: 2, id: 'prompt', label: 'Prompt', kinds: ['prompt'] },
  { n: 3, id: 'agent', label: 'Agent', kinds: ['agent-receive'] },
  { n: 4, id: 'llm', label: 'LLM', kinds: ['llm-plan'] },
  { n: 5, id: 'agent-token', label: 'Agent token', kinds: ['actor-token'] },
  { n: 6, id: 'exchange', label: 'Exchange', kinds: ['token-exchange'] },
  { n: 7, id: 'authorize', label: 'Authorize', kinds: ['authorize-decision'] },
  { n: 8, id: 'gateway', label: 'Gateway', kinds: ['gateway-check'] },
  { n: 9, id: 'tool', label: 'MCP tool', kinds: ['tool-dispatched', 'tool-refused', 'tool-held'] },
  { n: 10, id: 'reply', label: 'Reply', kinds: ['agent-reply'] },
];

/** Derive the chain map for a run: ok | deny | held | not-in-run per step, from the hops. */
export function deriveChainSteps(hops) {
  return CHAIN_STEPS.map((s) => {
    const hop = (hops || []).find((h) => s.kinds.includes(h.kind));
    const state = !hop || hop.verdict === 'skip' ? 'not-in-run'
      : hop.verdict === 'ok' ? 'ok'
      : hop.verdict === 'deny' ? 'deny'
      : 'held';
    return { ...s, state, hopN: hop?.n ?? null };
  });
}

/** The mock claim sets behind the run: what the user token holds, what the agent holds,
 *  and what the exchange minted (the real engine token plus a mock scope for teaching). */
export function claimSetsFor({ user, actor, token, aud }) {
  const now = Math.floor(Date.now() / 1000);
  const userClaims = {
    iss: `${IDP}/as`, sub: user, aud: aud || token?.aud || 'ai-demo-standalone',
    scope: 'openid accounts:read transfers:write profile', azp: 'airline-app-mock',
  };
  const agentClaims = { iss: `${IDP}/as`, sub: actor, client_id: actor, scope: 'mcp:call' };
  const delegatedClaims = { ...(token || { sub: user, act: { sub: actor } }), aud: aud || token?.aud || 'ai-demo-standalone', scope: 'accounts:read', client_id: actor, iss: `${IDP}/as` };
  if (delegatedClaims.iat == null) { delegatedClaims.iat = now; delegatedClaims.exp = now + 3600; }
  return { userClaims, agentClaims, delegatedClaims };
}

const scopes = (s) => String(s || '').split(/\s+/).filter(Boolean);

/** diff of the delegated token vs the user token: what was added, rebound, narrowed. */
export function tokenDiff(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const rebound = ['aud'].filter((k) => k in after && k in before && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  const narrowed = scopes(after.scope).length < scopes(before.scope).length ? ['scope'] : [];
  return { added, rebound, narrowed };
}

/** The run's tokens as raw, MOCK-labelled cards (no decoding, no /token-display endpoint). */
export function buildTokenCards(args) {
  const { userClaims, agentClaims, delegatedClaims } = claimSetsFor(args);
  return [
    { id: 'user-token', title: 'User token', role: 'subject — the traveller', mock: true, claims: userClaims },
    { id: 'agent-token', title: 'Agent token', role: 'actor — the agent itself', mock: true, claims: agentClaims },
    {
      id: 'delegated-token', title: 'Delegated token', role: 'delegated — the agent acting for the traveller', mock: true,
      claims: delegatedClaims, diff: tokenDiff(userClaims, delegatedClaims),
    },
  ];
}

/** One run as demo-hop/1 hops, in the plan's fixed 10-step order. Every hop is enriched
 *  from the vendored catalog (title, fact, spec) so validateHop passes untouched. */
export function buildDemoHops({ verdict, user, actor, tool, amount, token, trace, aud, consent = true }) {
  const { userClaims, delegatedClaims } = claimSetsFor({ user, actor, token, aud });
  const stage = verdict.stage;
  const decision = verdict.decision;
  const tp = () => `00-${trace.traceId}-${trace.span()}-01`;
  const hops = [];
  const add = (kind, from, to, v, label, request, response, extra = {}) => {
    const raw = { n: hops.length + 1, kind, from, to, verdict: v, mock: true, label };
    if (v !== 'skip') { raw.traceparent = tp(); raw.request = request; raw.response = response; }
    else { raw.request = {}; raw.response = {}; }
    hops.push(enrichHop(raw, catalog, extra));
  };

  // 1 Sign-in — the customer is signed in with the mock persona picker.
  add('sign-in', 'browser', 'idp', 'ok',
    'The traveller signs in (mock persona picker; no password asked or stored)',
    { method: 'POST', url: `${IDP}/as/flows/mock-signin`, headers: { 'content-type': 'application/json' }, body: { persona: user, signIn: 'mock persona picker; no password is asked or stored' } },
    { status: 200, headers: {}, body: { status: 'COMPLETED', access_token: '[redacted]', token_type: 'Bearer', expires_in: 300 } });

  // 2 Prompt — the words only; the session says who is asking.
  add('prompt', 'browser', 'bff', 'ok',
    'The traveller asks the agent (words only — no token leaves the page)',
    { method: 'POST', url: `${BFF}/api/assistant/turn`, headers: { 'content-type': 'application/json' }, body: { message: "(the traveller's words; mock)" } },
    { status: 200, headers: {}, body: { accepted: true } });

  // 3 Agent receives, 4 the plan (the model proposes; policy decides).
  add('agent-receive', 'bff', 'agent', 'ok',
    'The request reaches the agent, which works out what the traveller wants',
    { method: 'POST', url: 'internal://agent/turn', body: { from: user, message: "(the traveller's words; mock)" } },
    { status: 200, headers: {}, body: { accepted: true } });
  add('llm-plan', 'agent', 'llm', 'ok',
    'The agent plans one tool call (scripted intent match, mock)',
    { method: 'POST', url: 'internal://agent/plan', body: { message: "(the traveller's words; mock)" } },
    { status: 200, headers: {}, body: { proposed_tool: tool, args: amount != null ? { amount } : {} } },
    { kv: [['proposed tool', tool]] });

  // 5 Agent token, 6 Exchange — the only place act= is minted.
  add('actor-token', 'bff', 'idp', 'ok',
    'The agent gets its own token (client credentials), so the exchange has a real actor',
    { method: 'POST', url: `${IDP}/as/token.oauth2`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&client_id=[write-only]&client_secret=[write-only]' },
    { status: 200, headers: {}, body: { access_token: '[redacted]', token_type: 'Bearer', expires_in: 300 } });
  add('token-exchange', 'bff', 'idp', consent ? 'ok' : 'skip',
    'Token exchange (RFC 8693): the user token + the agent token become the delegated token',
    { method: 'POST', url: `${IDP}/as/token.oauth2`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=[redacted]&actor_token=[redacted]&scope=accounts:read' },
    { status: 200, headers: {}, body: { access_token: '[redacted]', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'accounts:read' } },
    { before: userClaims, after: delegatedClaims, kv: [['grant_type', 'token-exchange']] });

  // 7 Authorize, 8 Gateway, 9 Tool — the first refusal wins, exactly like the engine.
  const gatewayVerdict = stage === 'token' || stage === 'gateway' ? 'deny' : 'ok';
  const authorizeVerdict = stage !== 'policy' ? 'skip'
    : decision === 'PERMIT' ? 'ok'
    : decision === 'OBLIGATION' ? 'obligation'
    : 'deny';
  const toolKind = decision === 'PERMIT' ? 'tool-dispatched'
    : decision === 'OBLIGATION' ? 'tool-held'
    : 'tool-refused';
  const toolVerdict = decision === 'PERMIT' ? 'ok'
    : decision === 'OBLIGATION' ? 'obligation'
    : stage === 'policy' ? 'deny'
    : 'skip';

  add('authorize-decision', 'gateway', 'authorize', authorizeVerdict,
    'The policy decision point answers on the call (groups, tier, tool, amount)',
    { method: 'POST', url: 'https://pdp.airline.example/decision', headers: { 'content-type': 'application/json' }, body: { subject: user, action: tool, context: { act: { sub: actor || null } } } },
    { status: 200, headers: {}, body: { decision } },
    { decision: { outcome: decision, by: 'authorize policy', reasons: [verdict.reason] } });

  add('gateway-check', 'bff', 'gateway', gatewayVerdict,
    'The gateway checks the delegated token before any tool sees the call',
    { method: 'POST', url: `${GW}/mcp`, headers: { 'content-type': 'application/json', authorization: 'Bearer [redacted-jwt]' }, body: { jsonrpc: '2.0', method: 'tools/call', params: { name: tool } } },
    gatewayVerdict === 'deny'
      ? { status: 403, headers: { 'www-authenticate': 'Bearer error="insufficient_scope"' }, body: { error: verdict.code, reason: verdict.reason } }
      : { status: 200, headers: {}, body: { forwarded: true } },
    gatewayVerdict === 'deny'
      ? { stages: [
          { name: 'Signature', result: 'pass', note: 'ES256, key from the mock JWKS' },
          { name: 'Audience', result: 'pass', note: String(aud || token?.aud || 'ai-demo-standalone') },
          { name: 'act chain', result: 'fail', note: verdict.reason },
        ] }
      : { stages: [
          { name: 'Signature', result: 'pass', note: 'ES256, key from the mock JWKS' },
          { name: 'Audience', result: 'pass', note: String(aud || token?.aud || 'ai-demo-standalone') },
          { name: 'act present', result: 'pass', note: String(actor || '(none)') },
        ] });

  add(toolKind, 'gateway', 'mcp', toolVerdict,
    decision === 'OBLIGATION'
      ? `The tool call is held, not sent: ${verdict.code} — the human resolves it before anything runs`
      : decision === 'PERMIT'
      ? 'The MCP tool runs, fully attributable'
      : 'Refused before the tool: nothing executed',
    { method: 'POST', url: `${MCP}/mcp`, headers: { 'content-type': 'application/json', authorization: 'Bearer [redacted-jwt]' }, body: { jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: amount != null ? { amount } : {} } } },
    decision === 'OBLIGATION'
      ? { status: 202, headers: {}, body: { held: true, obligation: verdict.code } }
      : decision === 'PERMIT'
      ? { status: 200, headers: {}, body: { result: { tool, isError: false, content: [{ type: 'text', text: 'mock result (synthetic)' }] } } }
      : { status: 403, headers: {}, body: { dispatched: false, refused_by: 'policy', reason: verdict.code } },
    decision === 'OBLIGATION' ? { kv: [['obligation', verdict.code]] } : {});

  // 10 Reply — the agent answers the traveller whatever the outcome; the reply carries data, never a token.
  add('agent-reply', 'agent', 'agent', 'ok',
    decision === 'PERMIT' ? 'The agent answers from the tool result' : decision === 'OBLIGATION' ? 'The agent explains it is waiting for the traveller' : 'The agent explains the refusal',
    {}, {},
    { kv: [['reply', verdict.reason]] });

  return hops;
}
