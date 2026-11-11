// The A2A nested-act delegation engine, mirroring the AI-DEMO2 UC2/UC2.5/UC2.6/UC2.7 contract in mock.
// Sources (read-only shapes from the app):
//   - a2aDelegationService: the chained RFC 8693 exchange. Exchange #1: user token + generalist
//     actor -> act={generalist}. Exchange #2: generalist token + specialist actor ->
//     act={specialist, act:{generalist}} — the nested act chain, scope narrowed per hop.
//   - GatewayTokenPolicy: nested-act chains (depth >= 2) skip the exchanger actor allow-list;
//     the PDP validates the chain. A specialist identity NOT registered in the Agent Card
//     registry is DENIED (UC2.6: PERMIT_THEN_DENY — authorization keys on WHO is acting).
//   - Agent Card protocol beat (UC2.7): the A2A JSON-RPC surface serves an Agent Card; a call
//     without the bearer is a real 401 before anything else.
// Pure functions + in-process stores: no I/O, no clocks inside decisions (timestamps injected).

export const LIMITS = { clientId: 64, audience: 100, scope: 200, card: 4096, name: 64 };

export const A2A_AUDIENCE = 'ai-demo-standalone';

/** The generalist's Agent Card (UC2.7 protocol beat, mock of the A2A spec's well-known doc). */
export function agentCard({ host = 'agents.ais-demo.example' } = {}) {
  return {
    name: 'Generalist Banking Agent',
    description: 'Routes banking tasks to registered specialist sub-agents.',
    url: `https://${host}/a2a`,
    protocolVersion: '0.2.9',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      { id: 'portfolio', name: 'Portfolio summary', description: 'Specialist: portfolio summary via the A2A gateway.' },
      { id: 'wire', name: 'Wire support', description: 'Specialist: wire-transfer support via the A2A gateway.' },
    ],
  };
}

export class A2AInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);

/** act chain depth (PingOneAuthorizeClient shape): count nodes with sub/client_id walking act.act… */
export function actChainDepth(act) {
  let depth = 0;
  let node = act;
  while (node && typeof node === 'object' && (node.sub || node.client_id)) {
    depth += 1;
    node = node.act;
  }
  return depth;
}

/** RFC 8693 exchange #1: user consents; the generalist acts for them. */
export function exchangeOne({ userSub, generalistClientId, scope = 'a2a:get_portfolio_summary', now = Date.now, ttlSeconds = 600 } = {}) {
  const sub = clean(userSub, LIMITS.clientId);
  const actor = clean(generalistClientId, LIMITS.clientId);
  if (!sub) throw new A2AInputError('user_required', 'userSub is required: a delegated token always acts for a real human');
  if (!actor) throw new A2AInputError('actor_required', 'generalistClientId is required');
  const iat = Math.floor(now() / 1000);
  return {
    sub, act: { sub: actor }, aud: A2A_AUDIENCE,
    scope: clean(scope, LIMITS.scope), iat, exp: iat + Math.max(1, Math.min(ttlSeconds, 86400)),
    iss: 'ai-demo-standalone (mock exchange #1)',
  };
}

/**
 * RFC 8693 exchange #2: the specialist acts via the generalist. The nested act chain:
 * act={specialist, act:{generalist}}. The handoff narrows scope — the specialist token
 * carries ONLY the scope the handoff granted (least privilege across agent hops).
 */
export function exchangeTwo({ generalistToken, specialistClientId, scope = 'a2a:get_portfolio_summary', now = Date.now, ttlSeconds = 300 } = {}) {
  if (generalistToken == null || typeof generalistToken !== 'object' || Array.isArray(generalistToken)) {
    throw new A2AInputError('bad_token', 'the generalist token from exchange #1 is required');
  }
  if (actChainDepth(generalistToken.act) < 1) throw new A2AInputError('bad_chain', 'exchange #2 requires the exchange-#1 act chain');
  const actor = clean(specialistClientId, LIMITS.clientId);
  if (!actor) throw new A2AInputError('actor_required', 'specialistClientId is required');
  // Scope narrowing: the specialist may hold AT MOST the generalist's scope, never more.
  const narrowed = clean(scope, LIMITS.scope);
  const parent = String(generalistToken.scope || '').split(/\s+/).filter(Boolean);
  const granted = narrowed.split(/\s+/).filter((s) => parent.includes(s));
  const iat = Math.floor(now() / 1000);
  return {
    sub: generalistToken.sub, // still acts for the SAME user
    act: { sub: actor, act: { sub: clean(generalistToken.act.sub, LIMITS.clientId) } },
    aud: A2A_AUDIENCE,
    scope: granted.join(' '),
    iat, exp: iat + Math.max(1, Math.min(ttlSeconds, 86400)),
    iss: 'ai-demo-standalone (mock exchange #2, scope narrowed)',
  };
}

/**
 * The registry check (UC2.6): the A2A gateway routes a specialist call only when the
 * SPECIALIST identity is registered. Keys on WHO is acting, not just who they act for.
 * @returns {{ decision: 'PERMIT'|'DENY', code: string|null, reason: string }}
 */
export function evaluateA2a({ token, registeredSpecialists, requiredScope = 'a2a:get_portfolio_summary', now = Date.now, upstreamAudiences = [] } = {}) {
  if (token == null || typeof token !== 'object' || Array.isArray(token)) {
    return { decision: 'DENY', code: 'invalid_token', reason: 'token missing or malformed' };
  }
  const sub = String(token.sub ?? '').trim();
  if (!sub) return { decision: 'DENY', code: 'missing_sub', reason: 'Token missing required sub claim' };
  const exp = Number(token.exp);
  if (Number.isFinite(exp) && exp * 1000 <= now()) {
    return { decision: 'DENY', code: 'token_expired', reason: 'Token expired' };
  }
  const depth = actChainDepth(token.act);
  if (depth < 2) {
    return { decision: 'DENY', code: 'chain_not_nested', reason: 'A2A calls require a nested act chain (specialist -> generalist): a plain act={agent} token is the generalist acting alone, not a handoff' };
  }
  const specialist = String(token.act.sub ?? '').trim();
  const registered = (registeredSpecialists || []).map((s) => clean(s, LIMITS.clientId));
  if (!registered.includes(specialist)) {
    return {
      decision: 'DENY',
      code: 'unregistered_specialist',
      reason: `Specialist "${specialist}" is not in the Agent Card registry — authorization keys on WHO is acting, not just who they act for. Same user, same delegation shape, but an unregistered agent identity is denied.`,
    };
  }
  const scopes = String(token.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(requiredScope)) {
    return { decision: 'DENY', code: 'scope_narrowed_away', reason: `The handoff did not grant "${requiredScope}" — the specialist's scope was narrowed at exchange #2` };
  }
  const aud = Array.isArray(token.aud) ? token.aud.map(String) : [String(token.aud ?? '')];
  const upstream = (upstreamAudiences || []).map((a) => String(a).toLowerCase());
  if (upstream.some((u) => aud.map((a) => a.toLowerCase()).includes(u))) {
    return { decision: 'DENY', code: 'upstream_audience', reason: 'Token audience names an upstream MCP server' };
  }
  return {
    decision: 'PERMIT',
    code: null,
    reason: `Nested act chain (depth ${depth}): ${specialist} -> ${token.act.act?.sub} acting for ${sub}. Scope [ ${scopes.join(', ')} ] — least privilege across agent hops, the full chain visible in the token.`,
  };
}

/** The registry store (UC2.6 live flip): register/revoke a specialist; the next decision moves. */
export function createRegistry({ seeded = ['portfolio-specialist', 'wire-specialist'] } = {}) {
  let set = new Set(seeded.map((s) => clean(s, LIMITS.clientId)));
  return {
    all() { return [...set]; },
    isRegistered(name) { return set.has(clean(name, LIMITS.clientId)); },
    set(name, registered) {
      const n = clean(name, LIMITS.clientId);
      if (!n) throw new A2AInputError('name_required', 'specialist name is required');
      if (registered) set.add(n); else set.delete(n);
      return this.all();
    },
  };
}
