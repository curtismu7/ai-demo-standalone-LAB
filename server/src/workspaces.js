// Rule 13: a workspace id keeps one visitor's state apart from another's. Per workspace: the
// directory flips, the recent runs. Bounded in count, size and age.
//
// Workspace AUTH: a workspace id alone is not a credential. The server mints an HMAC-signed
// workspace token per id (mintWorkspaceToken); every stateful route requires the matching
// X-Workspace-Token header. A token for workspace A is worthless at workspace B, and a forged
// id + token pair fails the signature. verifyWorkspaceToken is constant-time on the MAC.
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 20;

/** The server-wide workspace-signing key. Set AIDEMOLAB_SERVER_KEY to keep tokens valid
 *  across restarts (paired with the durable store); otherwise a fresh key is minted per boot
 *  and every outstanding token is invalid after a restart — the client re-mints. */
export function serverKey(env = process.env) {
  const k = env.AIDEMOLAB_SERVER_KEY;
  return typeof k === 'string' && k.length >= 16 ? k : `whsk_${randomUUID()}${randomUUID()}`;
}

export function mintWorkspaceToken(id, key) {
  return createHmac('sha256', key).update(`workspace:${id}`).digest('base64url');
}

/** A stable per-session fingerprint: HMAC over the workspace id + its token. The receipts
 *  store records it when a challenge is raised and requires the same one at redemption, so a
 *  genuine receipt captured by a DIFFERENT session (different workspace token) is refused. */
export function workspaceTokenFingerprint(id, token, key) {
  return createHmac('sha256', key).update(`presenter:${id}:${token ?? ''}`).digest('base64url');
}

export function verifyWorkspaceToken(id, token, key) {
  if (typeof token !== 'string' || !token) return false;
  const expected = Buffer.from(mintWorkspaceToken(id, key));
  let given;
  try { given = Buffer.from(token); } catch { return false; }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : null;
}

// DURABILITY: with stateDir set, each workspace's state is written to <stateDir>/<id>.json
// on every mutation and loaded on first touch, so a server restart keeps challenges,
// receipts, directory flips and runs (the signed receipt + signed workspace token make the
// persisted state trustworthy again after a restart — set AIDEMOLAB_SERVER_KEY to keep
// tokens valid across restarts). The receipts store object is rebuilt by re-hydrating the
// receipts store's maps from the persisted plain data via makeExtra's hydrate hook.
export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now, makeDirectory, makeExtra, stateDir = null, hydrateExtra } = {}) {
  const map = new Map(); // id -> { runs, at, directory }
  const sweep = () => {
    const t = now();
    // Evict by oldest TOUCH (insertion order lies: a long-lived active workspace is touched
    // constantly), and consider every entry — no early break.
    const expired = [...map.entries()].filter(([, v]) => t - v.at > ttlMs).sort((a, b) => a[1].at - b[1].at);
    for (const [id] of expired) map.delete(id);
    const byAge = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
    while (map.size > max) { const [id] = byAge.shift(); map.delete(id); }
  };
  const blank = () => ({ runs: [], directory: makeDirectory ? makeDirectory() : null, extra: makeExtra ? makeExtra() : null, at: now() });

  const fileFor = (id) => path.join(stateDir, `${id}.json`);
  const persist = (id, v) => {
    if (!stateDir) return;
    try {
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
      const snapshot = {
        runs: v.runs, directory: v.directory,
        receipts: v.extra?.receipts?.export?.() ?? null,
        roster: v.extra?.roster?.export?.() ?? null,
        registry: v.extra?.registry?.export?.() ?? null,
        at: v.at,
      };
      fs.writeFileSync(fileFor(id), JSON.stringify(snapshot));
    } catch (e) { console.error('workspace_persist_failed:', e.message); }
  };
  const load = (id) => {
    if (!stateDir) return null;
    try {
      if (!fs.existsSync(fileFor(id))) return null;
      const snap = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
      const v = blank();
      v.runs = snap.runs ?? [];
      v.directory = snap.directory ?? v.directory;
      if (hydrateExtra) v.extra = hydrateExtra(v.extra, snap);
      return v;
    } catch (e) { console.error('workspace_load_failed:', e.message); return null; }
  };

  return {
    state(id) {
      sweep();
      let v = map.get(id);
      if (!v) { v = load(id); if (v) map.set(id, v); }
      if (!v) { v = blank(); map.set(id, v); }
      v.at = now();
      return v;
    },
    runs(id) { sweep(); const v = map.get(id); return { workspace: id, runs: v ? v.runs : [] }; },
    record(id, run) {
      const v = this.state(id);
      v.runs = [...v.runs, { ...run, at: now() }].slice(-MAX_RUNS);
      persist(id, v);
      sweep();
      return v.runs;
    },
    /** Call after mutating a workspace's directory / receipts / roster outside of record(). */
    touch(id) { const v = map.get(id); if (v) persist(id, v); },
    resetWorkspace(id) {
      map.delete(id);
      if (stateDir) { try { fs.rmSync(fileFor(id), { force: true }); } catch { /* already gone */ } }
    },
    size() { return map.size; },
  };
}
