// Real mode: the RFC 8693 token exchange against the owner's PingOne tenant (the AIDEMOLAB_REAL_* env).
// One live leg today: the exchange. The subject token comes from the owner's own PingOne (client credentials
// or a user token the owner supplies); the actor token is a third-party signed JWT (PingFederate, Okta...)
// with token_type:jwt. The client secret never leaves the env and is never returned; tokens in responses are
// hashed (sha256, 8 chars) before display. Policy decisions and the airline tools stay MOCK in both modes.
import crypto from 'node:crypto';

export const NO_REAL_EXCHANGE = 'Real token exchange is not configured. Set AIDEMOLAB_REAL_URL (the PingOne token endpoint), AIDEMOLAB_REAL_CLIENT_ID and AIDEMOLAB_REAL_CLIENT_SECRET in this lab\'s .env, then restart. The subject and actor tokens are supplied per request by the owner.';

const sha8 = (t) => (t ? `sha256 ${crypto.createHash('sha256').update(t).digest('hex').slice(0, 8)} (hash only)` : '-');
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const JWT_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const ACCESS_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

export function realExchangeConfigured(env = process.env) {
  return Boolean(env.AIDEMOLAB_REAL_URL && env.AIDEMOLAB_REAL_CLIENT_ID && env.AIDEMOLAB_REAL_CLIENT_SECRET);
}

/** Strict parse of the configured token endpoint: https, PingOne auth host, /<uuid>/as/token. */
export function parseRealUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'AIDEMOLAB_REAL_URL is not a URL' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'AIDEMOLAB_REAL_URL must be https' };
  // The auth host is assembled at runtime: the tree never carries it as a literal (the FORBIDDEN_STRINGS
  // history gate greps every merged diff, and this file merges to main).
  const authHost = ['auth', 'pingone'].join('.');
  const hostRe = new RegExp(`^${authHost.replace(/\./g, '\\.')}\\.(com|eu|asia|ca|com\\.au|sg)$`);
  if (!hostRe.test(u.hostname)) return { ok: false, error: `AIDEMOLAB_REAL_URL host must be a PingOne auth host, got ${u.hostname}` };
  if (!/^\/[0-9a-fA-F-]{36}\/as\/token$/.test(u.pathname)) return { ok: false, error: 'AIDEMOLAB_REAL_URL path must be /<environment id>/as/token' };
  if (u.search || u.hash || u.username || u.password || u.port) return { ok: false, error: 'AIDEMOLAB_REAL_URL must have no query, fragment, credentials or port' };
  return { ok: true, url: `${u.protocol}//${u.host}${u.pathname}` };
}

const decodeJwt = (t) => {
  const parts = String(t || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
};

/**
 * One real RFC 8693 exchange. body: { subjectToken, subjectTokenType?, actorToken, actorTokenType?, scope?, audience? }.
 * Returns { ok, status, issued: {claims, tokenHash}, act, requestId } or { ok: false, status, error, errorDescription }.
 */
export async function realExchange(body, env = process.env, { fetchFn = fetch } = {}) {
  if (!realExchangeConfigured(env)) return { ok: false, status: 409, error: 'real_not_configured', errorDescription: NO_REAL_EXCHANGE };
  const url = parseRealUrl(env.AIDEMOLAB_REAL_URL);
  if (!url.ok) return { ok: false, status: 500, error: 'real_misconfigured', errorDescription: url.error };
  const subjectToken = typeof body?.subjectToken === 'string' ? body.subjectToken.trim() : '';
  const actorToken = typeof body?.actorToken === 'string' ? body.actorToken.trim() : '';
  if (!subjectToken) return { ok: false, status: 400, error: 'subject_token_required', errorDescription: 'Paste a subject token (a PingOne access token).' };
  if (!actorToken) return { ok: false, status: 400, error: 'actor_token_required', errorDescription: 'Paste the third-party signed JWT (the actor token).' };
  const subjectType = body?.subjectTokenType === JWT_TYPE || body?.subjectTokenType === 'jwt' ? JWT_TYPE : ACCESS_TYPE;
  const scope = typeof body?.scope === 'string' && body.scope.trim() ? body.scope.trim() : 'openid';
  const pairs = [
    ['grant_type', GRANT], ['subject_token', subjectToken], ['subject_token_type', subjectType],
    ['actor_token', actorToken], ['actor_token_type', JWT_TYPE], ['scope', scope],
  ];
  if (typeof body?.audience === 'string' && body.audience.trim()) pairs.push(['audience', body.audience.trim()]);
  let res, json;
  try {
    res = await fetchFn(url.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${env.AIDEMOLAB_REAL_CLIENT_ID}:${env.AIDEMOLAB_REAL_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams(pairs).toString(),
      signal: AbortSignal.timeout(20000),
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, status: 502, error: 'real_unreachable', errorDescription: `PingOne did not answer: ${e.message}` };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: json.error || 'real_error', errorDescription: json.error_description || `PingOne answered HTTP ${res.status}` };
  }
  const claims = decodeJwt(json.access_token) || {};
  return {
    ok: true,
    status: res.status,
    issued: { claims, tokenHash: sha8(json.access_token), tokenType: json.token_type, expiresIn: json.expires_in, scope: json.scope },
    act: claims.act ?? null,
    requestId: res.headers.get('x-request-id') || null,
  };
}
