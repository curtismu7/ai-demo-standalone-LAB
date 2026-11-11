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
];

export const TOOLS = [
  { name: 'get_balance', kind: 'read', lesson: 'Account balance read — the standard gated call.' },
  { name: 'get_transactions', kind: 'read', lesson: 'Transaction history read.' },
  { name: 'create_wire_transfer', kind: 'write', lesson: 'Premium-only: Standard tier is denied before the amount is even read.' },
];
