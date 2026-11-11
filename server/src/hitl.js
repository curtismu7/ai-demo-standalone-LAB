// The HITL engine (mock of AI-DEMO2 UC7/UC8/UC22): amount bands produce OBLIGATIONS, not
// decisions. The agent pauses, the human satisfies the obligation (consent modal, MFA/OTP,
// CIBA push), a receipt is presented back, and the policy RE-EVALUATES the same call.
// Bands (from simulatedAuthorizeService, mock values): confirm $250 = consent only;
// step-up $500 = consent + MFA; transfers always need HITL approval; agent-initiated
// sensitive actions with no browser get CIBA. There is no separate hard-deny band: the tier
// ceilings in pdp.js ($2000 Standard, $50000 Premium) are the effective hard limits, and the
// policy denies before this layer runs.
// Challenges and receipts are issued by the SERVER into a per-workspace store (createReceipts:
// bounded, 5 minute TTL). A receipt is looked up there, checked against user + tool + obligation
// + amount as the server stored them, and CONSUMED on the call it permits — a hand-written,
// replayed, expired or mismatched receipt leaves the call paused.
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { LIMITS } from './pdpData.js';
import { clean } from './clean.js';

export const BANDS = { confirm: 250, stepUp: 500 };
export const TTL_SECONDS = 300; // a challenge and a receipt each live 5 minutes
export const STORE_MAX = 200; // per workspace, per kind of record (challenges, answered ids, receipts)

export class HitlInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

/** The obligation an amount+tool produces, mirroring simulatedAuthorizeService. */
export function evaluateObligation({ tool, amount = null, hitlTools = ['create_transfer', 'create_wire_transfer', 'approve_large_transfer'], cibaTools = ['move_money'], consentGiven = null } = {}) {
  const t = clean(tool, LIMITS.id);
  // UC27: a client-sent "consent already given" flag is never trusted — any boolean the
  // caller asserts would skip the gate entirely. The check runs and ignores it, fail-closed.
  if (consentGiven === true && hitlTools.includes(t)) {
    return { obligation: 'HITL_CONSENT', bypassAttempt: true, reason: `"${t}" arrived with a client-sent "consent already given" flag — the flag is ignored, not trusted: a verified, call-bound HitlApproved receipt is the only thing that satisfies this tool, so the call still pauses.` };
  }
  if (hitlTools.includes(t)) return { obligation: 'HITL_CONSENT', reason: `"${t}" is a human-approval tool: the agent pauses until a verified HitlApproved receipt is presented (an approval is never an MFA).` };
  if (cibaTools.includes(t)) return { obligation: 'CIBA', reason: `"${t}" is a sensitive agent-initiated action with no browser: the backend calls bc-authorize and the user approves out-of-band on their device.` };
  if (amount == null) return { obligation: null, reason: 'no amount to band' };
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0) throw new HitlInputError('bad_amount', 'amount must be a non-negative number');
  if (a >= BANDS.stepUp) return { obligation: 'STEP_UP', reason: `$${a} clears the step-up threshold ($${BANDS.stepUp}): consent + MFA required.` };
  if (a >= BANDS.confirm) return { obligation: 'CONFIRM', reason: `$${a} clears the confirm threshold ($${BANDS.confirm}): explicit consent required, no MFA.` };
  return { obligation: null, reason: `$${a} is below the confirm threshold — no obligation` };
}

/** A challenge: what the human must satisfy, bound to the exact call that raised it. */
export function createChallenge({ obligation, user, tool, amount = null, now = Date.now, ttlSeconds = TTL_SECONDS, rand = () => randomUUID().replaceAll('-', '').slice(0, 12), presenter = null } = {}) {
  if (!['CONFIRM', 'STEP_UP', 'HITL_CONSENT', 'CIBA'].includes(obligation)) throw new HitlInputError('bad_obligation', 'obligation must be CONFIRM, STEP_UP, HITL_CONSENT or CIBA');
  const id = `chg_${rand()}${rand()}`.slice(0, 40);
  const iat = Math.floor(now() / 1000);
  const needs = obligation === 'STEP_UP' ? ['consent', 'mfa'] : obligation === 'CIBA' ? ['ciba_approval'] : ['consent'];
  return {
    challengeId: id, obligation, user: clean(user, LIMITS.id), tool: clean(tool, LIMITS.id),
    amount: amount == null ? null : Number(amount), needs, createdAt: iat, expiresAt: iat + ttlSeconds,
    // PRESENTER BINDING: the workspace-token fingerprint of the session that raised the
    // challenge. The store requires the same fingerprint at redemption, so a genuine receipt
    // captured by a different session is refused. `presenter` is stripped from client copies.
    presenter,
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
      if (typeof answer.otp !== 'string') return { ok: false, code: 'otp_invalid', reason: 'the OTP must be a string' };
      if (answer.otp.trim() !== '123123') return { ok: false, code: 'otp_invalid', reason: 'wrong OTP (mock accepts 123123)' };
    }
    if (n === 'ciba_approval' && answer.cibaApproved !== true) return { ok: false, code: 'ciba_pending', reason: 'the user has not approved on their device yet (mock: approve once)' };
  }
  // mfaVerified is true only when this challenge asked for MFA and the OTP above matched.
  return { ok: true, code: null, reason: 'all needs satisfied', mfaVerified: needs.includes('mfa') };
}

/** The receipt minted from a satisfied challenge, bound to user+tool+obligation+amount.
 *  MfaVerified is true only when the caller reports a verified MFA answer (verifyAnswer's
 *  mfaVerified): a CONFIRM-band consent receipt carries MfaVerified=false. */
/** Canonical signing payload for a receipt: the fields a verifier cares about, in a fixed order. */
export function receiptSigningPayload(receipt) {
  return JSON.stringify([receipt.receiptId, receipt.challengeId, receipt.obligation, receipt.user, receipt.tool, receipt.amount ?? null, receipt.issuedAt, receipt.presenter ?? null]);
}

/** HMAC-SHA256 over the canonical payload. A receipt whose sig does not verify was not issued
 *  by this workspace's server (edited, fabricated, or from another workspace). */
export function signReceipt(receipt, signingKey) {
  return createHmac('sha256', signingKey).update(receiptSigningPayload(receipt)).digest('base64url');
}

export function receiptSignatureValid(receipt, signingKey) {
  if (!signingKey) return true; // no key configured: signature checks are off (mock default)
  if (typeof receipt.sig !== 'string' || !receipt.sig) return false;
  const expected = Buffer.from(signReceipt(receipt, signingKey));
  const given = Buffer.from(receipt.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function mintReceipt({ challenge, mfaVerified = false, now = Date.now, rand = () => randomUUID().replaceAll('-', '').slice(0, 12), signingKey = null } = {}) {
  if (challenge == null || typeof challenge !== 'object') throw new HitlInputError('bad_challenge', 'challenge is required');
  const receipt = {
    receiptId: `rcp_${rand()}${rand()}`.slice(0, 44),
    challengeId: challenge.challengeId,
    obligation: challenge.obligation,
    user: challenge.user,
    tool: challenge.tool,
    amount: challenge.amount ?? null,
    presenter: challenge.presenter ?? null,
    issuedAt: Math.floor(now() / 1000),
    claims: challenge.obligation === 'HITL_CONSENT' ? { HitlApproved: true }
      : challenge.obligation === 'CIBA' ? { CibaApproved: true }
      : { MfaVerified: mfaVerified === true, ConsentGiven: true },
  };
  if (signingKey) receipt.sig = signReceipt(receipt, signingKey);
  return receipt;
}

const money = (n) => (n == null ? 'no amount' : `$${n}`);

/** Is this receipt valid for THIS call? Binding check: same user, same tool, same amount (a
 *  missing amount only matches a missing amount), same obligation, and unexpired. Pass the
 *  receipt AS THE SERVER STORED IT (createReceipts().redeem does), never the caller's copy. */
export function receiptValid({ receipt, user, tool, obligation, amount = null, now = Date.now } = {}) {
  if (receipt == null || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, code: 'no_receipt', reason: 'no receipt presented' };
  if (receipt.user !== clean(user, LIMITS.id)) return { valid: false, code: 'receipt_user_mismatch', reason: `the receipt belongs to ${receipt.user}, not ${user}` };
  if (receipt.tool !== clean(tool, LIMITS.id)) return { valid: false, code: 'receipt_tool_mismatch', reason: `the receipt was issued for ${receipt.tool}, not ${tool}` };
  const issuedFor = receipt.amount == null ? null : Number(receipt.amount);
  const callAmount = amount == null ? null : Number(amount);
  if (issuedFor !== callAmount) return { valid: false, code: 'receipt_amount_mismatch', reason: `the receipt was issued for ${money(issuedFor)}, not ${money(callAmount)}` };
  if (receipt.obligation !== obligation) return { valid: false, code: 'receipt_obligation_mismatch', reason: `the receipt satisfies ${receipt.obligation}, not ${obligation}` };
  if (receipt.issuedAt * 1000 + TTL_SECONDS * 1000 <= now()) return { valid: false, code: 'receipt_expired', reason: 'the receipt expired (5 minutes)' };
  return { valid: true, code: null, reason: 'receipt binds this exact call' };
}

/**
 * The per-workspace store behind challenges and receipts. The server issues every challenge and
 * receipt into it and trusts nothing the caller sends back except the id:
 *   - a challenge is answered against the copy stored here (a caller cannot edit `needs`);
 *   - a receipt is accepted only if this store issued it, it is unspent, and it binds the call;
 *   - a receipt is consumed when it permits a call (single use); a refused attempt does not burn it.
 * Bounded: at most `max` records per kind (oldest dropped first); records are dropped one TTL
 * after they expire, so a stale id still gets a clear "expired" answer for a while.
 */
export function createReceipts({ now = Date.now, max = STORE_MAX, signingKey = `whsk_${randomUUID()}`, initial = null } = {}) {
  // Each workspace store gets its own HMAC key: a receipt is only genuine if THIS key signed it.
  const pending = new Map(initial?.pending ?? []); // challengeId -> challenge awaiting an answer
  const answered = new Set(initial?.answered ?? []); // challengeIds already answered
  const issued = new Map(initial?.issued ?? []); // receiptId -> { receipt, used }
  const cap = (c) => { while (c.size > max) c.delete(c.keys().next().value); };
  const prune = () => {
    const t = now();
    for (const [id, c] of pending) if ((c.expiresAt + TTL_SECONDS) * 1000 <= t) pending.delete(id);
    for (const [id, e] of issued) if ((e.receipt.issuedAt + 2 * TTL_SECONDS) * 1000 <= t) issued.delete(id);
  };
  return {
    now,
    /** Remember a challenge this server just issued. */
    track(challenge) { prune(); pending.set(challenge.challengeId, challenge); cap(pending); },
    /** The presenter fingerprint the store enforces at redemption (null = binding off). */
    presenterOf(id) { const c = pending.get(id); return c?.presenter ?? null; },
    /** The challenge as the server issued it, or null (never issued here, expired, or already answered). */
    challenge(id) { return typeof id === 'string' ? pending.get(id) ?? null : null; },
    /** Mark a challenge answered (single use). False when it already was. */
    spend(challengeId) {
      if (!challengeId || answered.has(challengeId)) return false;
      answered.add(challengeId); pending.delete(challengeId); cap(answered);
      return true;
    },
    spent(challengeId) { return answered.has(challengeId); },
    /** Remember a receipt this server just minted; sign it so it can be verified as genuine. */
    issue(receipt) { prune(); if (!receipt.sig) receipt.sig = signReceipt(receipt, signingKey); issued.set(receipt.receiptId, { receipt, used: false }); cap(issued); },
    /** Plain-data snapshot for the durable store; hydrate reverses it. */
    export() {
      return {
        pending: [...pending.entries()], answered: [...answered], issued: [...issued.entries()], signingKey,
      };
    },
    /** Check a presented receipt against the store and the call; consume it when it is valid. */
    redeem({ receipt, user, tool, obligation, amount = null, presenter = null }) {
      if (receipt == null || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, code: 'no_receipt', reason: 'no receipt presented' };
      const entry = typeof receipt.receiptId === 'string' ? issued.get(receipt.receiptId) : undefined;
      if (!entry) return { valid: false, code: 'receipt_not_found', reason: 'no such receipt in this workspace store (never issued, expired, or already spent): a hand-written receipt is not accepted' };
      if (!receiptSignatureValid(receipt, signingKey) || !receiptSignatureValid(entry.receipt, signingKey)) return { valid: false, code: 'receipt_forged', reason: 'the receipt signature does not verify: it was not issued by this workspace' };
      if (entry.used) return { valid: false, code: 'receipt_spent', reason: 'this receipt was already used; a receipt permits one call' };
      // PRESENTER BINDING: the receipt belongs to the session that raised the challenge. A
      // genuine receipt captured by a different session (a different workspace token) is
      // refused — present your own challenge, not someone else's.
      if (entry.receipt.presenter && presenter !== null && entry.receipt.presenter !== presenter) {
        return { valid: false, code: 'receipt_presenter_mismatch', reason: 'this receipt was issued to a different session; raise your own challenge' };
      }
      const check = receiptValid({ receipt: entry.receipt, user, tool, obligation, amount, now });
      if (!check.valid) return check;
      entry.used = true;
      return { ...check, receipt: entry.receipt };
    },
    size() { return { challenges: pending.size, answered: answered.size, receipts: issued.size }; },
  };
}

/** The human answers a challenge: look it up in the store, verify the answer against the stored
 *  copy, spend it, and issue the receipt into the store. Returns { ok: true, receipt } or
 *  { ok: false, code, reason }; throws HitlInputError for a malformed request. */
export function answerChallenge({ receipts, challenge, answer } = {}) {
  if (challenge == null || typeof challenge !== 'object' || Array.isArray(challenge)) throw new HitlInputError('bad_challenge', 'challenge is required');
  if (answer == null || typeof answer !== 'object' || Array.isArray(answer)) throw new HitlInputError('bad_answer', 'answer is required');
  const id = challenge.challengeId;
  if (receipts.spent(id)) return { ok: false, code: 'challenge_spent', reason: 'this challenge was already answered; run the call again' };
  const stored = receipts.challenge(id);
  if (!stored) return { ok: false, code: 'challenge_unknown', reason: 'no such challenge in this workspace store (never issued, expired, or already answered); raise one with POST /api/challenge' };
  const check = verifyAnswer({ challenge: stored, answer, now: receipts.now });
  if (!check.ok) return check;
  receipts.spend(id);
  const receipt = mintReceipt({ challenge: stored, mfaVerified: check.mfaVerified, now: receipts.now });
  receipts.issue(receipt);
  return { ok: true, receipt };
}
