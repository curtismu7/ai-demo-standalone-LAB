// The mock PDP: one decision engine behind every use case in the catalog.
// Shapes mirror the AI-DEMO2 decision chain (read-only contract, mock values):
//   1. TOKEN    — sub present, not expired, aud is this lab's audience
//   2. GATEWAY  — act chain validated: actor allow-list, no nested claim pointing upstream,
//                 an upstream audience is never accepted
//   3. POLICY   — directory groups read on EVERY decision (group gate), tool allow-list,
//                 amount band by tier (Standard $2000 / Premium $50000), premium-only tools
//   4. PERMIT   — with an obligation when step-up or consent is required (HITL is stage 2;
//                 the engine already returns the shape so the UI can grow into it)
// Pure functions + injected clock; all values mock. No I/O inside decisions.
import { LIMITS } from './pdpData.js';
import { evaluateObligation } from './hitl.js';

export const AUDIENCE = 'ai-demo-standalone';

export class PdpInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);

export const DEFAULT_ACTORS = ['demo-agent'];
export const UPSTREAM_AUDIENCES = ['mcp-weather.internal', 'mcp-portfolio.internal'];
export const PREMIUM_ONLY_TOOLS = ['create_wire_transfer', 'approve_large_transfer'];
export const TIERS = {
  Standard: { ceiling: 2000 },
  Premium: { ceiling: 50000 },
};

/** act chain depth: count nodes with sub/client_id walking act.act… (PingOneAuthorizeClient shape). */
export function actChainDepth(act) {
  let depth = 0; let node = act;
  while (node && typeof node === 'object' && (node.sub || node.client_id)) { depth += 1; node = node.act; }
  return depth;
}

/** Stage 1: the token itself. */
export function validateToken(token, { audience = AUDIENCE, now = Date.now, upstreamAudiences = UPSTREAM_AUDIENCES } = {}) {
  if (token == null || typeof token !== 'object' || Array.isArray(token)) {
    return { valid: false, stage: 'protocol', code: 'invalid_token', reason: 'token missing or malformed' };
  }
  if (!String(token.sub ?? '').trim()) return { valid: false, stage: 'protocol', code: 'missing_sub', reason: 'Token missing required sub claim' };
  const exp = Number(token.exp);
  if (Number.isFinite(exp) && exp * 1000 <= now()) return { valid: false, stage: 'gateway', code: 'token_expired', reason: 'Token expired' };
  const aud = Array.isArray(token.aud) ? token.aud.map(String) : [String(token.aud ?? '')];
  const up = (upstreamAudiences || []).map((a) => String(a).toLowerCase());
  if (up.some((u) => aud.map((a) => a.toLowerCase()).includes(u))) {
    return { valid: false, stage: 'gateway', code: 'upstream_audience', reason: 'Token audience names an upstream MCP server' };
  }
  if (!aud.map((a) => a.toLowerCase()).includes(audience.toLowerCase())) {
    return { valid: false, stage: 'gateway', code: 'bad_audience', reason: `Token audience is not ${audience}` };
  }
  return { valid: true, stage: null, code: null, reason: 'token valid' };
}

/** Stage 2: the gateway checks the delegation chain. */
export function validateChain(token, { authorizedActors = DEFAULT_ACTORS, now = Date.now } = {}) {
  const depth = actChainDepth(token?.act);
  if (depth === 0) return { valid: true, stage: null, code: null, reason: 'no delegation: the user acts directly' };
  if (depth < 2) {
    const actor = String(token.act?.sub ?? '');
    if (!(authorizedActors || []).includes(actor)) {
      return { valid: false, stage: 'gateway', code: 'unauthorized_actor', reason: `Unauthorized delegation actor: "${clean(actor, LIMITS.id)}" is not on the actor allow-list` };
    }
    return { valid: true, stage: null, code: null, reason: `act={${actor}} validated against the allow-list` };
  }
  // nested chain (>= 2): the PDP validates the chain; allow-list exempted (GatewayTokenPolicy shape)
  return { valid: true, stage: null, code: null, reason: `nested act chain (depth ${depth}) accepted; the policy validates it` };
}

/** Stage 3: the policy decides from the live directory + tool + amount. */
export function evaluatePolicy({ groups = [], tier = 'Standard', tool = '', amount = null, requiredGroup = 'privileged', premiumOnlyTools = PREMIUM_ONLY_TOOLS, tiers = TIERS } = {}) {
  const g = (groups || []).map((x) => clean(x, LIMITS.group));
  const t = clean(tool, LIMITS.id);
  const band = tiers[tier] || tiers.Standard;
  // The group gate is read on EVERY decision: outside the required group is denied
  // regardless of the token's scopes (UC9). Tool calls are the gated surface.
  if (t && !g.includes(requiredGroup)) {
    return { decision: 'DENY', code: 'group_entitlement', reason: `the user is not in the "${requiredGroup}" group — the policy denies regardless of the token's scopes` };
  }
  if (t && premiumOnlyTools.includes(t) && !g.includes('premiumTier')) {
    return { decision: 'DENY', code: 'tier_tool_not_allowed', reason: `tool "${t}" is restricted to Premium members; the user's tier is "${tier}"` };
  }
  if (amount != null) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 0) return { decision: 'DENY', code: 'bad_amount', reason: 'amount must be a non-negative number' };
    if (a > band.ceiling) return { decision: 'DENY', code: 'tier_amount_exceeded', reason: `$${a} exceeds the "${tier}" tier ceiling of $${band.ceiling}` };
  }
  return { decision: 'PERMIT', code: null, reason: `tier "${tier}" permits ${t || 'the call'}${amount != null ? ` up to $${band.ceiling}` : ''}` };
}

/**
 * One decision, all stages in order. Groups come from the caller's live directory snapshot
 * (the workspace store owns mutations), so the SAME token + call can flip with the directory.
 * @returns {{ decision, stage, code, reason, hops: string[] }}
 */
export function decide({ token, groups, tier = 'Standard', tool = '', amount = null, authorizedActors = DEFAULT_ACTORS, audience = AUDIENCE, now = Date.now } = {}) {
  const stages = [];
  const tok = validateToken(token, { audience, now });
  stages.push(`token: ${tok.valid ? 'ok' : `${tok.code}`}`);
  if (!tok.valid) return { decision: 'DENY', stage: tok.stage, code: tok.code, reason: tok.reason, stages };
  const chain = validateChain(token, { authorizedActors, now });
  stages.push(`chain: ${chain.valid ? 'ok' : `${chain.code}`}`);
  if (!chain.valid) return { decision: 'DENY', stage: chain.stage, code: chain.code, reason: chain.reason, stages };
  const pol = evaluatePolicy({ groups, tier, tool, amount });
  stages.push(`policy: ${pol.decision.toLowerCase()}`);
  if (pol.decision === 'DENY') return { decision: 'DENY', stage: 'policy', code: pol.code, reason: pol.reason, stages };
  const who = token.act?.sub ? `${token.act.sub} acting for ${token.sub}` : String(token.sub);
  return { decision: 'PERMIT', stage: 'policy', code: null, reason: `${who}${tool ? ` -> ${clean(tool, LIMITS.id)}` : ''}: ${pol.reason}`, stages };
}

/** Mock consent: mint a delegated token (sub = user, act = { actor }, 1 hour). */
export function exchange({ userSub, actorClientId, aud = AUDIENCE, now = Date.now, ttlSeconds = 3600 } = {}) {
  const sub = clean(userSub, LIMITS.id);
  const actor = clean(actorClientId, LIMITS.id);
  if (!sub) throw new PdpInputError('user_required', 'userSub is required: a delegated token always acts for a real human');
  if (!actor) throw new PdpInputError('actor_required', 'actorClientId is required');
  const iat = Math.floor(now() / 1000);
  return { sub, act: { sub: actor }, aud: clean(aud, 100), iat, exp: iat + Math.max(1, Math.min(ttlSeconds, 86400)), iss: 'ai-demo-standalone (mock consent)' };
}

/** The full authorize semantics: decide(), then the stage-2 obligation layer (bands + HITL
 *  tools). Returns { verdict, obligation, receiptCheck } — obligation is null when nothing
 *  paused the call; receiptCheck is null unless a receipt was presented, else { valid, code,
 *  reason }. A presented receipt completes the pause only if `receipts` (the server's store,
 *  createReceipts() in hitl.js) issued it, it is unspent and it binds this call; it is then
 *  CONSUMED. With no store a receipt cannot be verified, so it is refused. */
export function decideWithObligation({ receipt = null, receipts = null, ...args } = {}) {
  const verdict = decide(args);
  if (verdict.decision !== 'PERMIT') return { verdict, obligation: null, receiptCheck: null };
  let ob;
  try { ob = evaluateObligation({ tool: args.tool, amount: args.amount }); } catch { return { verdict, obligation: null, receiptCheck: null }; } // non-numeric amount: leave the policy verdict
  let obligation = null;
  let receiptCheck = null;
  if (ob.obligation) {
    if (receipt != null) {
      receiptCheck = receipts
        ? receipts.redeem({ receipt, user: args.token.sub, tool: args.tool, obligation: ob.obligation, amount: args.amount })
        : { valid: false, code: 'receipt_unverifiable', reason: 'there is no receipt store to verify the receipt against' };
    }
    if (receiptCheck?.valid) {
      const claims = Object.entries(receiptCheck.receipt.claims).map(([k, v]) => `${k}=${v}`).join(', ');
      verdict.reason = `${verdict.reason} — ${ob.obligation} satisfied by a bound receipt (${receiptCheck.receipt.receiptId.slice(0, 12)}…): ${claims} presented, receipt consumed.`;
      receiptCheck = { valid: true, code: null, reason: receiptCheck.reason };
    } else {
      obligation = ob.obligation;
      verdict.decision = 'OBLIGATION';
      verdict.code = ob.obligation;
      verdict.reason = receiptCheck ? `${ob.reason} The presented receipt was refused (${receiptCheck.code}): ${receiptCheck.reason}.` : ob.reason;
      if (receiptCheck) receiptCheck = { valid: false, code: receiptCheck.code, reason: receiptCheck.reason };
    }
  }
  return { verdict, obligation, receiptCheck };
}
