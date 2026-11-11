// The story as data: the WHOLE AI-DEMO2 dashboard as one mock standalone.
// The catalog of 87 use cases lives in server/data/catalog.json (extracted from
// AI-DEMO2's useCases.js); this file holds the lab's own framing, the stage-1
// scenarios (foundations + controls tracks), and the talk track.
// Text is {{token}} templated (see cast.js). Every host ends in .example. No real credential.
import catalog from '../data/catalog.json' with { type: 'json' };

export const CATALOG = catalog;

export const BANNER = 'SIMULATED: the whole AI-DEMO2 dashboard as one mock app. A mock PDP, a mock delegated-token chain, a mock directory. Nothing calls a real airline, identity provider, gateway or tenant.';

export const TITLE = "AI Demo Standalone — the {{castBrand}} dashboard, all use cases, one app";
export const INTRO = 'Every use case from the AI-DEMO2 dashboard in a single mock app. Pick a use case from the catalog, run it against the mock PDP: token validation, gateway chain checks, then the policy — directory groups read on EVERY decision, tier bands, premium-only tools — and the obligation layer: HITL (consent, MFA step-up, CIBA) and the A2A hand-off are wired now. The attacks, learn, tools and nhi tracks are catalog entries with their expected outcome.';

export const RULE = {
  name: 'Dashboard policy (mock)',
  appliesTo: 'The dashboard API at https://api.{{castHost}}.example',
  note: 'Mock shape of the AI-DEMO2 decision chain: token -> gateway -> policy -> permit. Not exported from, or checked against, a real policy engine.',
  defaults: { audience: 'ai-demo-standalone', tierCeilings: { Standard: 2000, Premium: 50000 }, actors: ['demo-agent'] },
};

export const TOOLS = [
  { name: 'get_balance', kind: 'read', lesson: 'Account balance read — the standard gated call.' },
  { name: 'get_transactions', kind: 'read', lesson: 'Transaction history read.' },
  { name: 'show_mortgage', kind: 'read', lesson: 'Mortgage lookup: a less-common read that carries the same delegated proof (UC33).' },
  { name: 'create_wire_transfer', kind: 'write', lesson: 'Premium-only: Standard tier is denied before the amount is even read.' },
  { name: 'brave_news_search', kind: 'read', lesson: 'Third-party search fronted at the gateway: the query argument is inspected against the content blocklist before the call is forwarded (UC41/UC42).' },
  { name: 'get_branch_hours', kind: 'public', lesson: 'Public catalog: answered without the full gate — browsing is anonymous, action is not (UC24).' },
];

export const FACTS = [
  { id: 'one-engine', status: 'measured', text: 'One decision engine answers every catalog use case: token validation, then the gateway chain check, then the policy. The tracks are framing over the same contract.', source: 'AI-DEMO2 simulatedAuthorizeService + GatewayTokenPolicy, read 2026-11-08' },
  { id: 'groups-every-call', status: 'measured', text: 'Directory groups are read on EVERY decision: outside the required group is denied regardless of scopes; the premium group EXPANDS capability (restricted tools + a $50000 ceiling).', source: 'AI-DEMO2 UC9/UC21, enforced live 2026-11-06' },
  { id: 'who-acting', status: 'measured', text: 'Delegated tokens carry act={agent}: the gateway validates the actor allow-list before any policy runs, and a token aimed at an upstream MCP audience is never accepted downstream.', source: 'AI-DEMO2 agentMcpTokenService, enforced live 2026-11-06' },
  { id: 'catalog-source', status: 'measured', text: 'The 87-use-case catalog is extracted from the dashboard\u2019s useCases.js — tracks, titles, expected outcomes, buyer stories — so the standalone matches what the real dashboard teaches.', source: 'AI-DEMO2 config/useCases.js, extracted 2026-11-08' },
  { id: 'stages', status: 'inferred', text: 'Foundations, controls and HITL run end-to-end now (the 11 scenarios below, plus the A2A panel). The attacks, learn, tools and nhi tracks are catalog entries with their expected outcome — the same engine will decide them.', source: 'this lab\u2019s build plan' },
];

export const SCENARIOS = [
  {
    id: 'uc1', ucId: 'UC1', track: 'foundations', title: 'UC1: consent mints act={agent} — the balance read permits',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'One consent, one delegated token: sub is the user, act={demo-agent} names the actor. Every action traces to a real human.',
  },
  {
    id: 'uc9', ucId: 'UC9', track: 'controls', title: 'UC9: not in the required group — denied regardless of scopes',
    user: 'jane', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'DENY',
    lesson: 'The policy reads directory groups on EVERY decision. No group, no access — the token\u2019s scopes cannot override it.',
  },
  {
    id: 'uc9a', ucId: 'UC9A', track: 'controls', title: 'UC9A: flip the directory entry — the very next call moves',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, flipTo: [],
    expected: 'DENY',
    lesson: 'Revoke the privileged group and the SAME call denies — no code change, no cache, no re-login.',
  },
  {
    id: 'uc21-tool', ucId: 'UC21', track: 'controls', title: 'UC21: Standard tier cannot invoke the premium wire',
    user: 'demoUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 500,
    expected: 'DENY',
    lesson: 'Positive least privilege: premium-only tools are listed in policy, never implied by scopes.',
  },
  {
    id: 'uc21-promote', ucId: 'UC21', track: 'controls', title: 'UC21: promote to Premium — the tool unlocks (then HITL pauses)',
    user: 'premiumUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 500,
    expected: 'OBLIGATION', obligation: 'HITL_CONSENT',
    lesson: 'Promotion first unlocks the tool (tier_tool_not_allowed is gone), then the HITL layer pauses it for approval — bands stack with groups, policy-driven, not hard-coded.',
  },
  {
    id: 'uc21-ceiling', ucId: 'UC21', track: 'controls', title: 'UC21: $60000 exceeds even the Premium ceiling',
    user: 'premiumUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 60000,
    expected: 'DENY',
    lesson: 'Tiers cap amounts: Premium ceiling $50000, Standard $2000. Amounts are policy bands, not tool arguments.',
  },
  {
    id: 'uc3-actgate', ucId: 'UC3', track: 'foundations', title: 'UC3: the act gate — the actor is checked on every call',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'The act claim is minted from the actor token at exchange, and the may_act consent is bridged to the PDP on EVERY call: a call whose acting agent does not match the consent is denied, and revoking the consent takes effect without waiting for the delegated token to expire.',
  },
  {
    id: 'uc6-rogue', ucId: 'UC6', track: 'foundations', title: 'UC6: an unknown agent is refused at the gateway',
    user: 'demoUser', actor: 'rogue-agent', tool: 'get_balance', amount: null,
    expected: 'DENY',
    lesson: 'Authorization keys on WHO is acting: the actor allow-list refuses an unregistered agent before any policy runs.',
  },
  {
    id: 'uc32-upstream', ucId: 'UC32', track: 'controls', title: 'UC32: a token aimed at an upstream MCP is refused',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, aud: 'mcp-weather.internal',
    expected: 'DENY',
    lesson: 'An audience is a destination: a token minted for an upstream MCP server is never accepted downstream.',
  },
  {
    id: 'uc19-lifecycle', ucId: 'UC19', track: 'foundations', title: 'UC19: the live agent identity — the exchange succeeds',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'This is the registered, live agent app: its credential mints the delegated token and the call proceeds. Retire or rotate that app in the PingOne console and the SAME call dies at the exchange step — one lifecycle action, no per-tool cleanup anywhere.',
  },
  {
    id: 'uc20-trace', ucId: 'UC20', track: 'foundations', title: 'UC20: observability — the full trace is reconstructable',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'Every hop is logged with the traceId and the act chain: sign-in, exchange, the Authorize decision, the tool dispatch. Who the agent was, who authorized it, what it did, what the policy decided — the full audit trail rebuilds from the evidence panels, no app-layer instrumentation.',
  },
  {
    id: 'uc33-mortgage', ucId: 'UC33', track: 'foundations', title: 'UC33: My mortgage — the proof travels with every tool',
    user: 'demoUser', actor: 'demo-agent', tool: 'show_mortgage', amount: null,
    expected: 'PERMIT',
    lesson: 'The identical RFC 8693 chain (sub is the human, act={demo-agent}) authorizes a mortgage lookup, not just the everyday balance read: delegated-access proof is not special-cased per tool, so the attribution coverage does not shrink as the tool surface grows.',
  },
  {
    id: 'uc34-patterns', ucId: 'UC34', track: 'foundations', title: 'UC34: Spot unusual patterns — reasoning rides the same rails',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_transactions', amount: null,
    expected: 'PERMIT',
    lesson: 'Free-form reasoning is not a shortcut: the agent decides WHAT to look at (the recent-activity read), but every underlying call still runs the same token-exchange, gateway and Authorize legs as a deterministic chip. Unusual patterns surface through the same governed pipeline.',
  },
  {
    id: 'uc35-why', ucId: 'UC35', track: 'foundations', title: 'UC35: Why was that blocked? — the explanation reads the run',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'The agent narrates the REAL events of the run — the act chain, the group gate, the Authorize verdict — not a canned script. The explanation is only as good as the evidence the chain produced, so it cannot drift from what actually fired.',
  },
  {
    id: 'uc7-stepup', ucId: 'UC7', track: 'hitl', title: 'UC7: MFA step-up — the agent pauses, the human completes MFA',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_transactions', amount: 600,
    expected: 'OBLIGATION', obligation: 'STEP_UP',
    lesson: 'From $500 up: consent + MFA (the tier ceiling, $2000 Standard and $50000 Premium, still denies first). The agent PAUSES — it cannot self-approve. The receipt (MfaVerified) re-evaluates the SAME call.',
  },
  {
    id: 'uc5-scope', ucId: 'UC5', track: 'attacks', title: 'UC5: wrong scope — a read-scoped token calling a write tool is refused',
    user: 'demoUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 100, scope: 'accounts:read',
    expected: 'DENY',
    lesson: 'Scope enforcement is cold: the token says read, the tool needs write — 403 insufficient_scope at the gateway before any tool runs. Read cannot become write no matter how the call is framed.',
  },
  {
    id: 'uc10-takeover', ucId: 'UC10', track: 'attacks', title: 'UC10: account takeover — reading another user\u2019s account is denied',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, resourceOwner: 'otherUser',
    expected: 'DENY',
    lesson: 'Authorization includes WHICH resource, not just WHICH action: the policy binds the resource to the token subject and denies the cross-owner call even with valid scopes and a clean act chain. Ownership decides.',
  },
  {
    id: 'uc11-badclient', ucId: 'UC11', track: 'attacks', title: 'UC11: bad client — a token minted for another API is refused 401',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, aud: 'weather-api.example',
    expected: 'DENY',
    lesson: 'Token validation comes first: aud/exp/iss/nbf are checked before any routing, so a token minted for audience X is worthless at audience Y. An audience is a destination.',
  },
  {
    id: 'uc13-deputy', ucId: 'UC13', track: 'attacks', title: 'UC13: confused deputy — a forged actor header cannot change who acts',
    user: 'demoUser', actor: 'rogue-agent', tool: 'get_balance', amount: null,
    expected: 'DENY',
    lesson: 'Actor identity comes from the native act claim minted at the exchange — never from a header. The injected X-Acting-For: demo-agent is ignored; the allow-list sees the real actor and refuses an unregistered one.',
  },
  {
    id: 'uc16b-forward', ucId: 'UC16b', track: 'attacks', title: 'UC16b: raw user-token forwarding — the BFF refuses to hand your token to a tool',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, rawUserToken: true,
    expected: 'DENY',
    lesson: 'Zero Trust at the source: the user\u2019s raw token never crosses to the agent runtime or a tool — only exchanged, agent-scoped tokens with an act claim leave the BFF. The forwarding attempt is blocked before the gateway.',
  },
  {
    id: 'uc29-outage', ucId: 'UC29', track: 'attacks', title: 'UC29: token-validation outage — the gateway fails closed',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, validationDown: true,
    expected: 'DENY',
    lesson: 'Token validation is on the request path for EVERY call: when the validation backend cannot be reached the gateway refuses with a 503 rather than letting traffic through. An outage degrades to deny, never to allow.',
  },
  {
    id: 'uc8-hitl', ucId: 'UC8', track: 'hitl', title: 'UC8: HITL approval — an approval is never an MFA',
    user: 'demoUser', actor: 'demo-agent', tool: 'create_transfer', amount: 100,
    expected: 'OBLIGATION', obligation: 'HITL_CONSENT',
    lesson: 'Human-approval tools always pause the agent, whatever the amount. Only a verified, call-bound HitlApproved receipt moves it.',
  },
  {
    id: 'uc22-ciba', ucId: 'UC22', track: 'hitl', title: 'UC22: CIBA — out-of-band approval on the user\u2019s device',
    user: 'demoUser', actor: 'demo-agent', tool: 'move_money', amount: null,
    expected: 'OBLIGATION', obligation: 'CIBA',
    lesson: 'An agent has no browser in which to prompt: the backend calls bc-authorize and the user approves out-of-band; the receipt (CibaApproved) re-evaluates the call.',
  },
  // ── P6 batch 3 (final): controls 3, demo 2, hitl 1 — in-app reaches 31 of 87 ──
  {
    id: 'uc4-overscoped', ucId: 'UC4', track: 'controls', title: 'UC4: overscoped agent — the exchange grants only what the task needs',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'The agent asked for write; the task needed only read — the exchange narrows the token to the task\u2019s required scope before any tool runs. Least privilege at mint time: even a misconfigured or compromised agent holds the minimum.',
  },
  {
    id: 'uc41-search', ucId: 'UC41', track: 'controls', title: 'UC41: third-party search server, filtered at the gateway',
    user: 'demoUser', actor: 'demo-agent', tool: 'brave_news_search', amount: null, query: 'regional weather outlook',
    expected: 'PERMIT',
    lesson: 'The gateway fronts an unmodified third-party search MCP server: it validates the token, inspects the query argument against the content blocklist, then forwards. The vendor never sees — or enforces — the bank\u2019s policy.',
  },
  {
    id: 'uc42-search-blocked', ucId: 'UC42', track: 'controls', title: 'UC42: third-party search — the blocked query is denied',
    user: 'demoUser', actor: 'demo-agent', tool: 'brave_news_search', amount: null, query: 'bitcoin price today',
    expected: 'DENY',
    lesson: 'The gateway kills the query before Brave ever sees it: no vendor log, no billed call, no data leaving the perimeter. Egress control sits in ONE place instead of being re-implemented in every tool integration.',
  },
  {
    id: 'uc24-public', ucId: 'UC24', track: 'demo', title: 'UC24: Act 1 — the public catalog answers before any sign-in',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_branch_hours', amount: null,
    expected: 'PERMIT',
    lesson: 'Progressive trust, act 1: the public branch catalog is answered without the group gate or a tier check — browsing needs no identity, while every real action on this same engine stays fully gated.',
  },
  {
    id: 'uc26-proof', ucId: 'UC26', track: 'demo', title: 'UC26: proof of enforcement — the live verdict on every use case',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'You do not have to take the agent\u2019s word for it: every run on this page answers from the SAME engine — token, gateway, policy — and the decision, its reason and its hops render live. Nothing is a slide; every claim is a replayable verdict.',
  },
  {
    id: 'uc27-bypass', ucId: 'UC27', track: 'hitl', title: 'UC27: HITL consent bypass — a claimed "already approved" still pauses',
    user: 'demoUser', actor: 'demo-agent', tool: 'create_transfer', amount: 600, consentGiven: true,
    expected: 'OBLIGATION', obligation: 'HITL_CONSENT',
    lesson: 'The call arrived with a client-sent "consent already given" flag: the flag is ignored, not trusted — no boolean can substitute for a verified, call-bound HitlApproved receipt, so the gate still pauses the call (fail-closed).',
  },
];

export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated: the PDP, the directory and the tokens are mock, mirroring what the AI-DEMO2 dashboard enforces.' },
  { id: 'one-engine', title: 'One engine, every track', say: 'Foundations, controls, HITL, attacks, learning — the tracks frame the same decision chain: token, gateway, policy.' },
  { id: 'groups', title: 'Groups on every call', say: 'Directory membership is read on EVERY decision. Flip it and the very next call moves — UC9A is the lesson.' },
  { id: 'tiers', title: 'Tiers are bands', say: 'Standard caps at $2000, Premium at $50000, and premium-only tools are listed in policy — never implied by scopes.' },
  { id: 'who-acting', title: 'WHO is acting', say: 'act={agent} names the actor; the allow-list refuses unknown agents at the gateway, before any policy.' },
  { id: 'unverified', title: 'What we do not claim', say: 'The mock decisions follow the enforced contract, but the values (users, groups, ceilings) are demo values. No real tenant.' },
  { id: 'attacks', title: 'The attack gallery', say: 'The attacks track runs in-app too: wrong scope, account takeover, bad client, confused deputy, raw token forwarding, and the fail-closed outage — each refused by the same chain: token, gateway, policy.' },
  { id: 'close', title: 'Close', say: 'Reset clears your workspace: directory flips and runs. Nothing was sent anywhere.' },
];
