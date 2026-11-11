// The NHI engine (mock of AI-DEMO2 UC-NHI1/UC-NHI2): non-human identity for agents.
// An agent gets its OWN key with its own scopes — not a copy of the user's. Lifecycle:
// register (joiner) -> rotate (mover) -> revoke (leaver), and every action emits a
// joiner/mover/leaver event an IGA system (SailPoint shape) could consume.
// Values are mock; revocation is immediate: a revoked key fails the next call.
import { randomBytes } from 'node:crypto';
import { clean, cleanText } from './clean.js';

export class NhiInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

export const KNOWN_SCOPES = ['a2a:get_balance', 'a2a:get_transactions', 'a2a:get_portfolio_summary', 'a2a:write', 'code:search'];
const rand = () => randomBytes(9).toString('base64url');

/** A mock agent access key. The key NEVER round-trips in full after mint (only a prefix). */
export function mintKey({ agentId, scopes, now = Date.now, ttlSeconds = 86400 } = {}) {
  const id = clean(agentId, LIMITS_ID);
  if (!id) throw new NhiInputError('agent_required', 'agentId is required');
  const sc = (Array.isArray(scopes) ? scopes : []).map((s) => clean(s, 40)).filter((s) => KNOWN_SCOPES.includes(s));
  if (!sc.length) throw new NhiInputError('scopes_required', `at least one known scope is required: ${KNOWN_SCOPES.join(', ')}`);
  const secret = `ak-mock-${rand()}`;
  const iat = Math.floor(now() / 1000);
  return {
    agentId: id, scopes: [...new Set(sc)], keyId: `key_${rand().slice(0, 10)}`,
    keyPrefix: secret.slice(0, 12), createdAt: iat, expiresAt: iat + Math.max(60, Math.min(ttlSeconds, 7 * 86400)),
    _secret: secret, // internal: verifyKey only
  };
}
const LIMITS_ID = 64;

/** Key check: revoked or expired keys fail. Revocation is immediate (identity-layer kill switch). */
export function verifyKey(key, { now = Date.now } = {}) {
  if (key == null || typeof key !== 'object') return { ok: false, code: 'no_key', reason: 'no key presented' };
  if (key.revoked) return { ok: false, code: 'key_revoked', reason: 'this key was revoked — every platform the agent touches loses access immediately' };
  if (Number(key.expiresAt) * 1000 <= now()) return { ok: false, code: 'key_expired', reason: 'the key expired; rotate it' };
  return { ok: true, code: null, reason: `key valid for ${key.agentId}, scopes [ ${key.scopes.join(', ')} ]` };
}

/** Scope enforcement for a tool call under an agent key (UC5's lesson at the key layer). */
export function keyAllows(key, scope) {
  if (verifyKey(key).ok === false) return { ok: false, code: 'key_invalid' };
  const s = clean(scope, 40);
  return key.scopes.includes(s) ? { ok: true, code: null } : { ok: false, code: 'insufficient_scope', reason: `the key carries [ ${key.scopes.join(', ')} ] — "${s}" was never granted` };
}

/** The JML feed: joiner/mover/leaver events in an IGA-queryable shape (UC-NHI2). */
export function createJml({ initial = null } = {}) {
  const events = Array.isArray(initial) ? [...initial] : [];
  return {
    emit(type, agentId, detail, now = Date.now()) {
      if (!['joiner', 'mover', 'leaver'].includes(type)) throw new NhiInputError('bad_event', 'type must be joiner, mover or leaver');
      const e = { id: `jml_${rand().slice(0, 10)}`, type, agentId: clean(agentId, LIMITS_ID), detail: cleanText(detail, 200), at: Math.floor(now() / 1000) };
      events.unshift(e);
      if (events.length > 100) events.pop();
      return e;
    },
    all() { return [...events]; },
  };
}

/** The per-workspace roster: registered agents, their keys, live status (UC-NHI1). */
export function createRoster({ initial = null } = {}) {
  const jml = createJml({ initial: initial?.jml ?? null });
  const agents = new Map(initial?.agents ?? []);
  return {
    jml,
    register(agentId, scopes, now = Date.now) {
      if (agents.has(clean(agentId, LIMITS_ID))) throw new NhiInputError('already_registered', `${agentId} is already on the roster`);
      const key = mintKey({ agentId, scopes, now });
      agents.set(key.agentId, { ...key, _secret: undefined, status: 'active', keyObj: key });
      jml.emit('joiner', key.agentId, `registered with scopes [ ${key.scopes.join(', ')} ]`, now);
      return { ...agents.get(key.agentId), keyObj: key };
    },
    rotate(agentId, now = Date.now) {
      const id = clean(agentId, LIMITS_ID);
      const a = agents.get(id);
      if (!a) throw new NhiInputError('not_registered', `${id} is not on the roster`);
      const key = mintKey({ agentId: id, scopes: a.scopes, now });
      a.keyId = key.keyId; a.keyPrefix = key.keyPrefix; a.createdAt = key.createdAt; a.expiresAt = key.expiresAt; a.keyObj = key;
      jml.emit('mover', id, `key rotated -> ${key.keyId} (old key invalid immediately)`, now);
      return { ...a };
    },
    revoke(agentId, now = Date.now) {
      const id = clean(agentId, LIMITS_ID);
      const a = agents.get(id);
      if (!a) throw new NhiInputError('not_registered', `${id} is not on the roster`);
      a.status = 'revoked';
      a.keyObj = { ...a.keyObj, revoked: true };
      jml.emit('leaver', id, 'revoked at the identity layer — every platform loses access immediately', now);
      return { ...a, keyObj: a.keyObj };
    },
    get(agentId) { const a = agents.get(clean(agentId, LIMITS_ID)); return a ? { ...a } : null; },
    all() { return [...agents.values()].map((a) => ({ ...a, keyObj: undefined })); },
    /** Plain-data snapshot for the durable store. */
    export() { return { agents: [...agents.entries()], jml: jml.export?.() ?? null }; },
  };
}
