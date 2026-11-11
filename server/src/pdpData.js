// Data for the mock PDP: scenario seeds per track and the label limits.
// The catalog (server/data/catalog.json) is extracted from AI-DEMO2's useCases.js;
// the decision CONTRACT here mirrors what AI-DEMO2 enforces, with mock values.
export const LIMITS = { id: 64, group: 40, amount: 8 };

// Seeded directory for stage 1 (foundation + controls scenarios). Per-workspace flips
// move the very next decision — the UC9A lesson, now catalog-wide.
export const DEFAULT_DIRECTORY = {
  demoUser: { groups: ['privileged'], tier: 'Standard' },
  premiumUser: { groups: ['privileged', 'premiumTier'], tier: 'Premium' },
  jane: { groups: [], tier: 'Standard' },
};

export const DEFAULT_TOKEN = {
  sub: 'demoUser', aud: 'ai-demo-standalone',
  exp: () => Math.floor(Date.now() / 1000) + 3600,
};

// Scenarios wired to catalog UCs (stage 1: foundations + controls). Each sets up the
// directory + token the way the UC states, then runs one call.
export const SCENARIOS = [
  {
    id: 'uc1', ucId: 'UC1', title: 'Consent mints act={agent} — the balance read permits',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'One consent, one delegated token: sub is the user, act={demo-agent} names the actor. Every action traces to a real human.',
  },
  {
    id: 'uc9', ucId: 'UC9', title: 'Not in the required group — denied regardless of scopes',
    user: 'jane', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'DENY', stage: 'policy',
    lesson: 'The policy reads directory groups on EVERY decision. No group, no access — the token\u2019s scopes cannot override it.',
  },
  {
    id: 'uc9a', ucId: 'UC9A', title: 'Flip the directory entry — the very next call moves',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, flipTo: [],
    expected: 'DENY', stage: 'policy',
    lesson: 'Revoke the privileged group and the SAME call denies — no code change, no cache, no re-login.',
  },
  {
    id: 'uc21-tool', ucId: 'UC21', title: 'Standard tier cannot invoke the premium wire',
    user: 'demoUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 500,
    expected: 'DENY', stage: 'policy',
    lesson: 'Positive least privilege: premium-only tools are listed in policy, never implied by scopes.',
  },
  {
    id: 'uc21-promote', ucId: 'UC21', title: 'Promote to Premium — the same call now permits',
    user: 'premiumUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 500,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'The premiumTier group expands the tool set and raises the ceiling to $50000. Policy-driven, not hard-coded.',
  },
  {
    id: 'uc21-ceiling', ucId: 'UC21', title: '$60000 exceeds even the Premium ceiling',
    user: 'premiumUser', actor: 'demo-agent', tool: 'create_wire_transfer', amount: 60000,
    expected: 'DENY', stage: 'policy',
    lesson: 'Tiers cap amounts: Premium ceiling $50000, Standard $2000. Amounts are policy bands, not tool arguments.',
  },
  {
    id: 'uc3-actgate', ucId: 'UC3', title: 'The act gate — the actor is checked on every call',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'The act claim is minted from the actor token at exchange, and the may_act consent is bridged to the PDP on EVERY call: a call whose acting agent does not match the consent is denied, and revoking the consent takes effect without waiting for the delegated token to expire.',
  },
  {
    id: 'rogue-actor', ucId: 'UC6', title: 'An unknown agent is refused at the gateway',
    user: 'demoUser', actor: 'rogue-agent', tool: 'get_balance', amount: null,
    expected: 'DENY', stage: 'gateway',
    lesson: 'Authorization keys on WHO is acting: the actor allow-list refuses an unregistered agent before any policy runs.',
  },
  {
    id: 'upstream-aud', ucId: 'UC32', title: 'A token aimed at an upstream MCP is refused',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null, aud: 'mcp-weather.internal',
    expected: 'DENY', stage: 'gateway',
    lesson: 'An audience is a destination: a token minted for an upstream MCP server is never accepted downstream.',
  },
  {
    id: 'uc19-lifecycle', ucId: 'UC19', title: 'The live agent identity — the exchange succeeds',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'This is the registered, live agent app: its credential mints the delegated token and the call proceeds. Retire or rotate that app in the PingOne console and the SAME call dies at the exchange step — one lifecycle action, no per-tool cleanup anywhere.',
  },
  {
    id: 'uc20-trace', ucId: 'UC20', title: 'Observability — the full trace is reconstructable',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'Every hop is logged with the traceId and the act chain: sign-in, exchange, the Authorize decision, the tool dispatch. Who the agent was, who authorized it, what it did, what the policy decided — the full audit trail rebuilds from the evidence panels, no app-layer instrumentation.',
  },
  {
    id: 'uc33-mortgage', ucId: 'UC33', title: 'My mortgage — the proof travels with every tool',
    user: 'demoUser', actor: 'demo-agent', tool: 'show_mortgage', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'The identical RFC 8693 chain (sub is the human, act={demo-agent}) authorizes a mortgage lookup, not just the everyday balance read: delegated-access proof is not special-cased per tool, so the attribution coverage does not shrink as the tool surface grows.',
  },
  {
    id: 'uc34-patterns', ucId: 'UC34', title: 'Spot unusual patterns — reasoning rides the same rails',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_transactions', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'Free-form reasoning is not a shortcut: the agent decides WHAT to look at (the recent-activity read), but every underlying call still runs the same token-exchange, gateway and Authorize legs as a deterministic chip. Unusual patterns surface through the same governed pipeline.',
  },
  {
    id: 'uc35-why', ucId: 'UC35', title: 'Why was that blocked? — the explanation reads the run',
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    expected: 'PERMIT', stage: 'policy',
    lesson: 'The agent narrates the REAL events of the run — the act chain, the group gate, the Authorize verdict — not a canned script. The explanation is only as good as the evidence the chain produced, so it cannot drift from what actually fired.',
  },
];

export const TOOLS = [
  { name: 'get_balance', kind: 'read', lesson: 'Account balance read — the standard gated call.' },
  { name: 'get_transactions', kind: 'read', lesson: 'Transaction history read.' },
  { name: 'show_mortgage', kind: 'read', lesson: 'Mortgage lookup: a less-common read that carries the same delegated proof (UC33).' },
  { name: 'create_wire_transfer', kind: 'write', lesson: 'Premium-only: Standard tier is denied before the amount is even read.' },
];
