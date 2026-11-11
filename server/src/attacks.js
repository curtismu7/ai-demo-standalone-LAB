// The attack gallery (mock of AI-DEMO2 UC4/UC5/UC10-UC18): each attack is a scripted flow
// whose refusal is the POINT. Every run returns the attacker's view (what they tried, what
// they got) and the defender's view (which layer stopped them, why). Values are mock; the
// defense shapes mirror what AI-DEMO2 enforces.
import { clean } from './clean.js';
import { LIMITS } from './pdpData.js';

export class AttackInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const WINDOW_MS = 10_000;

/** A per-workspace rate limiter (mock of the gateway's 429 flood defense, UC18). */
export function createRateLimiter({ max = 8, windowMs = WINDOW_MS } = {}) {
  let hits = [];
  return {
    attempt(nowFn = Date.now) {
      const t = nowFn();
      hits = hits.filter((h) => h > t - windowMs);
      hits.push(t);
      return { limited: hits.length > max, count: hits.length, max };
    },
    reset() { hits = []; },
  };
}

/**
 * Run one attack. Each returns:
 *   { attackId, tried, got: { status, code }, stoppedBy: { product, layer, why }, lesson, detail }
 * `user` is the legitimate user whose credentials/position the attacker abuses.
 */
export function runAttack(attackId, { user = 'demoUser', groups = ['privileged'], tier = 'Standard', rateLimiter = null, now = Date.now } = {}) {
  const u = clean(user, LIMITS.id);
  switch (attackId) {
    case 'uc4-overscoped': {
      // UC4: the agent ASKS for write but the policy narrows to what the task needed.
      return {
        attackId, tried: 'The agent requested write scope (create_transfer) for a task that only reads balances.',
        got: { status: 200, code: 'scope_narrowed' },
        stoppedBy: { product: 'PingFederate + PingOne Authorize', layer: 'mint', why: 'Least privilege at mint: the granted scope is narrowed to the task (read), never what was asked for. The write request then fails scope enforcement before any tool runs.' },
        lesson: 'Least privilege is enforced when the token is minted, not when the attacker is caught: ask for write, receive read.',
        detail: `granted scope: a2a:get_balance (requested: a2a:write) — the over-request is logged, not honored.`,
      };
    }
    case 'uc5-wrong-scope': {
      return {
        attackId, tried: 'The agent called a write tool with a read-scoped token.',
        got: { status: 403, code: 'insufficient_scope' },
        stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'enforce', why: 'Scope enforcement at the gateway: the token says read, the tool needs write — 403 insufficient_scope before any tool runs. Scopes say what the token may ask for.' },
        lesson: 'Scope enforcement is cold: read cannot become write no matter how the call is framed.',
        detail: 'token scope [ a2a:get_balance ] vs tool requirement [ a2a:write ] → 403',
      };
    }
    case 'uc10-account-takeover': {
      return {
        attackId, tried: `The agent (acting for ${u}) read account: OTHER-9999 — an account belonging to someone else.`,
        got: { status: 403, code: 'resource_owner_mismatch' },
        stoppedBy: { product: 'PingOne Authorize (PDP)', layer: 'policy', why: 'Resource-ownership matching: the policy compares the token sub (and its act chain) against the resource owner and denies anything the user does not own. Groups and tiers are irrelevant here — ownership decides.' },
        lesson: 'Authorization includes WHICH resource, not just WHICH action: the owner match stops account takeover even with valid scopes and a clean chain.',
        detail: `token sub=${u}, act={demo-agent} vs resource owner=OTHER-9999 → 403 resource_owner_mismatch`,
      };
    }
    case 'uc11-wrong-audience': {
      return {
        attackId, tried: 'The attacker presented a token minted for a different API at the banking gateway.',
        got: { status: 401, code: 'bad_audience' },
        stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'token', why: 'Audience validation before anything else: a token minted for audience X is worthless at audience Y. An audience is a destination — the gateway refuses tokens that were not minted for it, before any policy runs.' },
        lesson: 'An audience is a destination: tokens only open the door they were minted for.',
        detail: 'token aud=[ weather-api.example ] vs gateway aud=[ ai-demo-standalone ] → 401 bad_audience',
      };
    }
    case 'uc12-replay': {
      return {
        attackId, tried: 'The attacker captured a bearer+DPoP exchange and replayed BOTH verbatim from another machine.',
        got: { status: 401, code: 'invalid_dpop_proof' },
        stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'token', why: 'DPoP binds the token to a proof-of-possession key: each request must present a fresh proof signed by the private key. A replayed proof (same jti, replayed htm/htu/iat) fails — the stolen token is worthless without the key.' },
        lesson: 'With DPoP on, stealing the token is not enough: possession of the private key is checked on EVERY call, and proofs cannot be replayed.',
        detail: 'replayed DPoP proof jti=cap-1234, iat unchanged → 401 invalid_dpop_proof (proofs are single-use)',
      };
    }
    case 'uc13-actor-injection': {
      return {
        attackId, tried: 'The attacker injected X-Acting-For: admin — a header claiming a different actor — hoping the gateway trusts headers over the token.',
        got: { status: 403, code: 'unauthorized_actor' },
        stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'chain', why: 'Actor identity comes from the native act claim on the token — never from a header. The injected header is ignored (or logged as an attack signal); the allow-list sees the real actor and decides.' },
        lesson: 'Identity travels in signed claims, not headers: a header can claim anything; a claim is cryptographic.',
        detail: 'header X-Acting-For: admin (ignored); token act={demo-agent} checked against the allow-list → 403 unauthorized_actor for unregistered actors',
      };
    }
    case 'uc14-rar-exceeded': {
      return {
        attackId, tried: 'The agent presented a valid RAR intent (ceiling $500) and attempted a $5,000 transfer under it.',
        got: { status: 403, code: 'rar_amount_exceeded' },
        stoppedBy: { product: 'PingOne Authorize (PDP)', layer: 'policy', why: 'The RAR intent carries its own ceiling (azd.authorization_details[0].amount) — the policy checks the request against the INTENT, not just the tier. The overage is denied even though the tier would have allowed more.' },
        lesson: 'Pushed intent is a ceiling of its own: the agent cannot exceed what was consented, even inside its tier.',
        detail: `intent ceiling $500 < requested $5000 → 403 rar_amount_exceeded (tier ceiling ${tier === 'Premium' ? '$50000' : '$2000'} never reached)`,
      };
    }
    case 'uc15-intent-tamper': {
      return {
        attackId, tried: 'The attacker edited the intent token: amount 500 → 50000, then re-sent it.',
        got: { status: 401, code: 'invalid_intent_signature' },
        stoppedBy: { product: 'PingOne Authorize (PDP)', layer: 'token', why: 'The intent token is signed. Any edit invalidates the signature and the check fails before the amount is ever read — the tampered values are never trusted.' },
        lesson: 'Tampering is caught by the signature, not by reviewing values: a changed intent token is simply not an intent token.',
        detail: 'intent token body modified post-issuance → signature check fails → 401 invalid_intent_signature',
      };
    }
    case 'uc16-impersonation': {
      return {
        attackId, tried: 'The attacker called with the USER\'s token directly — no act claim, pretending to be the user with no agent in the chain.',
        got: { status: 401, code: 'no_act_claim' },
        stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'chain', why: 'Agent-originated calls REQUIRE an act claim: without one there is no attribution — who acted, for whom. The gateway rejects pure impersonation so every action traces to a real human and a named actor.' },
        lesson: 'No act claim, no attribution, no call: impersonation is refused so the chain of custody never has a gap.',
        detail: 'token sub=demoUser, act=absent, request came from an agent → 401 no_act_claim',
      };
    }
    case 'uc17-stale-token': {
      return {
        attackId, tried: 'The attacker captured a delegated token and used it 30 minutes later.',
        got: { status: 401, code: 'token_expired' },
        stoppedBy: { product: 'PingFederate (token validation)', layer: 'token', why: 'JIT ephemeral credentials: delegated tokens live minutes (mock TTL 3600s here; production minutes). By the time the capture is used, the exp claim has passed — validation refuses it.' },
        lesson: 'Short-lived credentials shrink the theft window: a captured token is already dead when the attacker tries it.',
        detail: 'token exp passed 30 min ago → 401 token_expired (TTL is the defense, not revocation)',
      };
    }
    case 'uc18-flood': {
      if (!rateLimiter) throw new AttackInputError('no_limiter', 'the flood attack needs the workspace rate limiter');
      const r = rateLimiter.attempt(now);
      if (r.limited) {
        return {
          attackId, tried: `Burst call #${r.count} of the flood — the attacker hammers the tool endpoint.`,
          got: { status: 429, code: 'rate_limited' },
          stoppedBy: { product: 'PingGateway (gateway/PEP)', layer: 'rate', why: `The gateway counts calls per window (${r.max}/${Math.round(r.windowMs / 1000)}s mock) and answers 429 once the burst exceeds it — the flood is cut off before it can exhaust the backend.` },
          lesson: 'Availability is an authorization concern too: the gateway cuts off the flood so the attack cannot exhaust the resource.',
          detail: `${r.count} calls in the window (max ${r.max}) → 429 rate_limited; legitimate callers keep a fresh window`,
        };
      }
      return {
        attackId, tried: `Burst call #${r.count} of the flood.`,
        got: { status: 200, code: null },
        stoppedBy: null,
        lesson: `Call ${r.count} of ${r.max} allowed — keep bursting and the gateway will cut the flood off at ${r.max}.`,
        detail: 'within the window limit',
      };
    }
    default:
      throw new AttackInputError('unknown_attack', `unknown attack id: ${clean(attackId, 40)}`);
  }
}

export const ATTACK_IDS = ['uc4-overscoped', 'uc5-wrong-scope', 'uc10-account-takeover', 'uc11-wrong-audience', 'uc12-replay', 'uc13-actor-injection', 'uc14-rar-exceeded', 'uc15-intent-tamper', 'uc16-impersonation', 'uc17-stale-token', 'uc18-flood'];

export const ATTACK_CATALOG = [
  { id: 'uc4-overscoped', ucId: 'UC4', title: 'UC4: overscoped agent — the mint narrows it', expected: 'narrowed', lesson: 'Least privilege at mint: ask for write, receive read.' },
  { id: 'uc5-wrong-scope', ucId: 'UC5', title: 'UC5: wrong scope — enforcement stops it cold', expected: 'DENY', lesson: 'Read cannot become write: scope enforcement is cold.' },
  { id: 'uc10-account-takeover', ucId: 'UC10', title: 'UC10: account takeover — the owner match denies', expected: 'DENY', lesson: 'Authorization includes WHICH resource, not just WHICH action.' },
  { id: 'uc11-wrong-audience', ucId: 'UC11', title: 'UC11: wrong audience — refused before a tool', expected: 'DENY', lesson: 'An audience is a destination.' },
  { id: 'uc12-replay', ucId: 'UC12', title: 'UC12: token theft + DPoP — the replay fails', expected: 'DENY', lesson: 'Stealing the token is not enough: proofs cannot be replayed.' },
  { id: 'uc13-actor-injection', ucId: 'UC13', title: 'UC13: confused deputy — headers lie, claims do not', expected: 'DENY', lesson: 'Identity travels in signed claims, not headers.' },
  { id: 'uc14-rar-exceeded', ucId: 'UC14', title: 'UC14: RAR intent exceeded — the overage is caught', expected: 'DENY', lesson: 'Pushed intent is a ceiling of its own.' },
  { id: 'uc15-intent-tamper', ucId: 'UC15', title: 'UC15: intent tampering — the signature catches it', expected: 'DENY', lesson: 'A changed intent token is simply not an intent token.' },
  { id: 'uc16-impersonation', ucId: 'UC16', title: 'UC16: impersonation — no act claim, no call', expected: 'DENY', lesson: 'No act claim, no attribution, no call.' },
  { id: 'uc17-stale-token', ucId: 'UC17', title: 'UC17: stale token — already dead when used', expected: 'DENY', lesson: 'Short-lived credentials shrink the theft window.' },
  { id: 'uc18-flood', ucId: 'UC18', title: 'UC18: flood — the gateway cuts it off (429)', expected: 'DENY', lesson: 'Availability is an authorization concern too.' },
];
