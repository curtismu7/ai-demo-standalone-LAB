// The HITL engine (mock of AI-DEMO2 UC7/UC8/UC22): amount bands produce OBLIGATIONS, not
// decisions. The agent pauses, the human satisfies the obligation (consent modal, MFA/OTP,
// CIBA push), a receipt is presented back, and the policy RE-EVALUATES the same call.
// Bands (from simulatedAuthorizeService, mock values): confirm $250 = consent only;
// step-up $500 = consent + MFA; transfers always need HITL approval; agent-initiated
// sensitive actions with no browser get CIBA. Receipts are per workspace and bound to the
// challenge they came from — a receipt cannot be replayed for a different call.
import { LIMITS } from './pdpData.js';
import { clean } from './clean.js';

export const BANDS = { confirm: 250, stepUp: 500, deny: 100000 };

export class HitlInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

/** The obligation an amount+tool produces, mirroring simulatedAuthorizeService. */
export function evaluateObligation({ tool, amount = null, hitlTools = ['create_transfer', 'create_wire_transfer', 'approve_large_transfer'], cibaTools = ['move_money'] } = {}) {
  const t = clean(tool, LIMITS.id);
  if (hitlTools.includes(t)) return { obligation: 'HITL_CONSENT', reason: `"${t}" is a human-approval tool: the agent pauses until a verified HitlApproved receipt is presented (an approval is never an MFA).` };
  if (cibaTools.includes(t)) return { obligation: 'CIBA', reason: `"${t}" is a sensitive agent-initiated action with no browser: the backend calls bc-authorize and the user approves out-of-band on their device.` };
  if (amount == null) return { obligation: null, reason: 'no amount to band' };
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0) throw new HitlInputError('bad_amount', 'amount must be a non-negative number');
  if (a > BANDS.deny) return { obligation: 'DENY', reason: `$${a} exceeds the hard deny ceiling of $${BANDS.deny}` };
  if (a >= BANDS.stepUp) return { obligation: 'STEP_UP', reason: `$${a} clears the step-up threshold ($${BANDS.stepUp}) but not the deny ceiling: consent + MFA required.` };
  if (a >= BANDS.confirm) return { obligation: 'CONFIRM', reason: `$${a} clears the confirm threshold ($${BANDS.confirm}): explicit consent required, no MFA.` };
  return { obligation: null, reason: `$${a} is below the confirm threshold — no obligation` };
}

/** A challenge: what the human must satisfy, bound to the exact call that raised it. */
export function createChallenge({ obligation, user, tool, amount = null, now = Date.now, ttlSeconds = 300, rand = () => Math.random().toString(36).slice(2, 12) } = {}) {
  if (!['CONFIRM', 'STEP_UP', 'HITL_CONSENT', 'CIBA'].includes(obligation)) throw new HitlInputError('bad_obligation', 'obligation must be CONFIRM, STEP_UP, HITL_CONSENT or CIBA');
  const id = `chg_${rand()}${rand()}`.slice(0, 40);
  const iat = Math.floor(now() / 1000);
  const needs = obligation === 'STEP_UP' ? ['consent', 'mfa'] : obligation === 'CIBA' ? ['ciba_approval'] : ['consent'];
  return {
    challengeId: id, obligation, user: clean(user, LIMITS.id), tool: clean(tool, LIMITS.id),
    amount: amount == null ? null : Number(amount), needs, createdAt: iat, expiresAt: iat + ttlSeconds,
    // CIBA carries an auth_req_id the backend polls for (mock)
    authReqId: obligation === 'CIBA' ? `ciba_${rand()}${rand()}`.slice(0, 44) : null,
  };
}

/** The human's answer to a challenge. OTP is fixed in mock (123123) exactly like AI-DEMO2's demo MFA. */
export function verifyAnswer({ challenge, answer, now = Date.now } = {}) {
  if (challenge == null || typeof challenge !== 'object' || Array.isArray(challenge)) throw new HitlInputError('bad_challenge', 'challenge is required');
  if (answer == null || typeof answer !== 'object' || Array.isArray(answer)) throw new HitlInputError('bad_answer', 'answer is required');
  if (challenge.expiresAt * 1000 <= now()) return { ok: false, code: 'challenge_expired', reason: 'the challenge expired; run the call again for a fresh one' };
  const needs = challenge.needs || [];
  for (const n of needs) {
    if (n === 'consent' && answer.consent !== true) return { ok: false, code: 'consent_required', reason: 'the user must explicitly approve (consent: true)' };
    if (n === 'mfa') {
      if (answer.otp == null) return { ok: false, code: 'otp_required', reason: 'the MFA challenge requires the OTP' };
      if (String(answer.otp).trim() !== '123123') return { ok: false, code: 'otp_invalid', reason: 'wrong OTP (mock accepts 123123)' };
    }
    if (n === 'ciba_approval' && answer.cibaApproved !== true) return { ok: false, code: 'ciba_pending', reason: 'the user has not approved on their device yet (mock: approve once)' };
  }
  return { ok: true, code: null, reason: 'all needs satisfied' };
}

/** The receipt minted from a satisfied challenge, bound to user+tool+obligation. */
export function mintReceipt({ challenge, now = Date.now, rand = () => Math.random().toString(36).slice(2, 12) } = {}) {
  if (challenge == null || typeof challenge !== 'object') throw new HitlInputError('bad_challenge', 'challenge is required');
  return {
    receiptId: `rcp_${rand()}${rand()}`.slice(0, 44),
    challengeId: challenge.challengeId,
    obligation: challenge.obligation,
    user: challenge.user,
    tool: challenge.tool,
    amount: challenge.amount ?? null,
    issuedAt: Math.floor(now() / 1000),
    claims: challenge.obligation === 'HITL_CONSENT' ? { HitlApproved: true }
      : challenge.obligation === 'CIBA' ? { CibaApproved: true }
      : { MfaVerified: true, ConsentGiven: true },
  };
}

/** Is this receipt valid for THIS call? Binding check: same user, same tool, same obligation,
 *  unexpired, and (when an amount is given) the same amount that raised the challenge. */
export function receiptValid({ receipt, user, tool, obligation, amount = null, now = Date.now } = {}) {
  if (receipt == null || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, code: 'no_receipt', reason: 'no receipt presented' };
  if (receipt.user !== clean(user, LIMITS.id)) return { valid: false, code: 'receipt_user_mismatch', reason: `the receipt belongs to ${receipt.user}, not ${user}` };
  if (receipt.tool !== clean(tool, LIMITS.id)) return { valid: false, code: 'receipt_tool_mismatch', reason: `the receipt was issued for ${receipt.tool}, not ${tool}` };
  if (receipt.obligation !== obligation) return { valid: false, code: 'receipt_obligation_mismatch', reason: `the receipt satisfies ${receipt.obligation}, not ${obligation}` };
  if (amount != null && receipt.amount != null && Number(receipt.amount) !== Number(amount)) return { valid: false, code: 'receipt_amount_mismatch', reason: `the receipt was issued for $${receipt.amount}, not $${amount}` };
  if (receipt.issuedAt * 1000 + 5 * 60 * 1000 <= now()) return { valid: false, code: 'receipt_expired', reason: 'the receipt expired (5 minutes)' };
  return { valid: true, code: null, reason: 'receipt binds this exact call' };
}

/** A per-workspace store of satisfied challenges (single-use receipts: one challenge, one receipt). */
export function createReceipts() {
  const spent = new Set();
  return {
    spend(challengeId) {
      if (!challengeId || spent.has(challengeId)) return false;
      spent.add(challengeId);
      return true;
    },
    spent(challengeId) { return spent.has(challengeId); },
  };
}
