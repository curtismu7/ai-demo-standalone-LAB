// P10: Real SIGN-IN only (owner decision 2026-11-11). The one leg this lab drives: a PingOne or PingFederate
// authorization-code + PKCE S256 sign-in with response_mode=pi.flow — no redirect is ever followed or served —
// then the code for tokens. The pattern (and much of the wording) follows customer-agent-LAB's real.js, which the
// owner verified live; this lab is login-only: no agent token, no token exchange, no gateway. Data stays mock.
//
// Secrets: the user client's secret is held in the config closure and sent only in the Authorization header of
// the token call. The password is a function argument used once in one request body and kept nowhere: not stored,
// not logged, not returned, not in a step. Real tokens are returned raw for the page to show (tokens are education,
// rule 4) with a REAL label; the refresh token is dropped. Every IdP call goes through assertAuthUrl(): https
// (http only to a loopback fake), the configured origin, and one of four fixed paths.
import { createHash, randomBytes } from 'node:crypto';
import { isLoopbackHost } from './safety.js';

export const TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_IN_FLIGHT = 2;
export const MAX_SESSIONS = 500;
// The redirect URI the IdP app must list. pi.flow never redirects: the IdP only checks that it matches the app;
// nothing is ever served there. One fixed loopback value per provider, both registered by the owner's setup.
export const REDIRECT_URIS = { pingone: 'http://127.0.0.1:7810/callback', pingfederate: 'http://127.0.0.1:7810/callback' };
// The sign-in asks for the OIDC scopes only (login only; data stays mock, so no resource scopes are needed).
export const SIGN_IN_SCOPES = 'openid profile email';
export const PASSWORD_SHOWN = '[typed by you in the Sign in dialog: sent once to the IdP, never stored, logged or shown]';
const SECRET_SHOWN = 'Basic [write-only: the client secret is never shown]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGION_TLD = { na: 'com', us: 'com', com: 'com', eu: 'eu', ca: 'ca', ap: 'asia', asia: 'asia' };
const PW_TYPE = 'application/vnd.pingidentity.usernamePassword.check+json'; // PingOne flows API only
const FLOW_ID = /^[A-Za-z0-9-]{1,64}$/;

export class RealRefused extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

const plain = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const SCOPE_LIST = /^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/;

// The sign-in configuration from this lab's own .env (AIDEMOLAB_SIGNIN_*), read by index.js and handed in here.
// provider: 'pingone' (default) or 'pingfederate'. Returns the config, or { problem } in fixed words naming the
// setting (never a value). AIDEMOLAB_SIGNIN_TEST_BASE (http on a loopback host) is the tests'/e2e's fake IdP.
export function signinConfig(settings = {}, env = {}) {
  const provider = String(settings.AIDEMOLAB_SIGNIN_PROVIDER || 'pingone').toLowerCase();
  if (!['pingone', 'pingfederate'].includes(provider)) return { problem: 'AIDEMOLAB_SIGNIN_PROVIDER must be pingone or pingfederate' };
  if (!plain(settings.AIDEMOLAB_SIGNIN_CLIENT_ID, 200)) return { problem: `the app .env has no valid AIDEMOLAB_SIGNIN_CLIENT_ID` };
  if (!plain(settings.AIDEMOLAB_SIGNIN_CLIENT_SECRET, 512)) return { problem: `the app .env has no valid AIDEMOLAB_SIGNIN_CLIENT_SECRET` };
  const username = settings.AIDEMOLAB_SIGNIN_USERNAME;
  if (provider === 'pingone') {
    if (!plain(username, 200)) return { problem: 'the app .env has no valid AIDEMOLAB_SIGNIN_USERNAME' };
    const environmentId = String(settings.PINGONE_ENVIRONMENT_ID || '');
    if (!UUID.test(environmentId)) return { problem: 'the app .env has no valid PINGONE_ENVIRONMENT_ID' };
    let base;
    if (env.AIDEMOLAB_SIGNIN_TEST_BASE) {
      try {
        const u = new URL(env.AIDEMOLAB_SIGNIN_TEST_BASE);
        if (u.protocol !== 'http:' || !isLoopbackHost(u.hostname) || u.username || u.password || u.pathname.replace(/\/+$/, '') !== `/${environmentId}`) throw new Error('bad');
        base = `${u.origin}/${environmentId}`;
      } catch { return { problem: 'AIDEMOLAB_SIGNIN_TEST_BASE must be http on a loopback host with the environment id as its path' }; }
    } else {
      const tld = REGION_TLD[String(settings.PINGONE_REGION || 'com').toLowerCase()];
      if (!tld) return { problem: 'the app .env has no valid PINGONE_REGION (com, eu, ca or asia)' };
      base = `https://auth.pingone.${tld}/${environmentId}`;
    }
    return { provider, environmentId, base, username, client: { id: settings.AIDEMOLAB_SIGNIN_CLIENT_ID, secret: settings.AIDEMOLAB_SIGNIN_CLIENT_SECRET } };
  }
  // PingFederate: the owner's own PF (or the ping-shared one). The base URL itself is the setting — a local-only
  // URL by rule; committed defaults stay .example/.invalid (this file carries no host literal at all).
  if (!plain(settings.AIDEMOLAB_SIGNIN_BASE_URL, 300)) return { problem: 'the app .env has no valid AIDEMOLAB_SIGNIN_BASE_URL (the PingFederate base, e.g. https://local.ping-devops.com:9031)' };
  let base;
  try { base = new URL(settings.AIDEMOLAB_SIGNIN_BASE_URL).toString().replace(/\/+$/, ''); } catch { return { problem: 'the app .env has no valid AIDEMOLAB_SIGNIN_BASE_URL' }; }
  const probe = new URL(base);
  if (probe.protocol !== 'https:' && !(probe.protocol === 'http:' && isLoopbackHost(probe.hostname))) return { problem: 'AIDEMOLAB_SIGNIN_BASE_URL must be https (or http on a loopback host for a fake)' };
  return { provider, base, username, client: { id: settings.AIDEMOLAB_SIGNIN_CLIENT_ID, secret: settings.AIDEMOLAB_SIGNIN_CLIENT_SECRET } };
}

// The last check before an IdP socket opens: the configured origin, https (http only on loopback), no credentials
// in the URL, and one of the fixed paths. PingFederate drives the same /as/authorize, /as/token, /as/resume paths;
// the flows API step is PingOne-only.
export function assertAuthUrl(target, base) {
  let url; let allowed;
  try { url = new URL(target); allowed = new URL(base); } catch { throw new RealRefused('bad_url', 'Not a URL'); }
  if (url.username || url.password) throw new RealRefused('credentials_in_url', 'Outbound URLs must not carry credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) throw new RealRefused('not_https', 'Outbound calls are https only');
  if (url.origin !== allowed.origin) throw new RealRefused('other_origin', 'Outbound calls may only reach the configured IdP');
  const p = allowed.pathname.replace(/\/+$/, '');
  const rest = url.pathname.startsWith(`${p}/`) ? url.pathname.slice(p.length) : null;
  const ok = rest === '/as/authorize' || rest === '/as/token' || rest === '/as/resume' || (rest !== null && rest.startsWith('/flows/') && FLOW_ID.test(rest.slice(7)));
  if (!ok || url.hash) throw new RealRefused('other_path', 'Outbound calls may only reach authorize, the flows API, resume and the token endpoint');
  if (url.search && rest !== '/as/authorize' && rest !== '/as/resume') throw new RealRefused('other_path', 'Only authorize and resume take a query');
  return url;
}

const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
export function decodeJwt(raw) {
  const parts = String(raw).split('.');
  if (parts.length !== 3) return null;
  try { const header = JSON.parse(b64(parts[0])); const claims = JSON.parse(b64(parts[1])); return header && claims && typeof claims === 'object' ? { header, claims } : null; } catch { return null; }
}
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null);
const short = (v) => (typeof v === 'string' && v.length > 10 ? `${v.slice(0, 6)}...` : '[short]');
const maskCookie = (c) => String(c).split(';')[0].replace(/=(.*)$/, (_m, v) => `=${short(v)}`);
const basic = (c) => `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`;

async function readCapped(response, max) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) { chunks.push(value.subarray(0, max - total)); await reader.cancel().catch(() => {}); return { text: Buffer.concat(chunks).toString('utf8'), truncated: true }; }
    chunks.push(value); total += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

// An IdP error in its own words (code and message, cut short); nothing else of the answer.
const p1Error = (r) => (r.json ? { error: str(r.json.error) ?? str(r.json.code), error_description: str(r.json.error_description) ?? str(r.json.message) ?? str(r.json.details?.[0]?.message), detail_code: str(r.json.details?.[0]?.code) } : { note: r.unreachable ? 'no answer' : r.redirected ? 'a redirect (never followed)' : 'the answer was not a JSON object' });
// After the password has been sent, the IdP's free text is never passed on (it could echo what was typed): codes only.
const p1Codes = (r) => (r.json ? { error: str(r.json.error, 80) ?? str(r.json.code, 80), detail_code: str(r.json.details?.[0]?.code, 80) } : p1Error(r));
// The IdP's own error words can echo what was sent (a client secret): the free-text fields of an answer are scrubbed
// of anything JWT-shaped and of the client secret before any of it is kept.
const JWT_RUN = /eyJ[A-Za-z0-9_-]{3,}(?:\.[A-Za-z0-9_-]*){0,2}/g;
export function scrubError(json, secrets = []) {
  const clean = (v) => (typeof v === 'string' ? secrets.filter((x) => typeof x === 'string' && x.length >= 4).reduce((t, x) => t.split(x).join('[secret]'), v.replace(JWT_RUN, '[redacted-jwt]')) : v);
  const out = { ...json };
  for (const k of ['error', 'error_description', 'message', 'code']) if (k in out) out[k] = clean(out[k]);
  if (Array.isArray(out.details)) out.details = out.details.map((d) => (d && typeof d === 'object' ? { ...d, ...('message' in d ? { message: clean(d.message) } : {}), ...('code' in d ? { code: clean(d.code) } : {}) } : d));
  return out;
}
const failText = (r, who = 'The IdP') => (r.unreachable ? `${who} did not answer (no connection, a timeout or an unreadable answer).` : r.redirected ? `${who} answered with a redirect; the lab never follows one.` : r.truncated ? 'The answer was larger than the lab reads, so it was cut off.' : `${who} answered HTTP ${r.status}.`);

export function createRealSignin({ config = { problem: 'not configured' }, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, now = Date.now } = {}) {
  const configured = () => !config.problem;
  const sessions = new Map(); // workspace id -> { accessToken, header, claims, idClaims, expiresAt, steps }
  let inFlight = 0;

  async function idp(url, init, traceparent) {
    const target = assertAuthUrl(url, config.base);
    let response; let body = { text: '', truncated: false };
    try {
      response = await fetchImpl(target.toString(), { ...init, headers: { ...init.headers, traceparent }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      body = await readCapped(response, maxBytes);
    } catch { return { status: 0, unreachable: true, json: null, cookies: [] }; }
    let json = null;
    if (!body.truncated && body.text) { try { const j = JSON.parse(body.text); json = j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { json = null; } }
    if (json) json = scrubError(json, [config.client?.secret]);
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    return { status: response.status, redirected: response.status >= 300 && response.status < 400, json, truncated: body.truncated, cookies };
  }
  const tokenCall = (form, traceparent) => idp(`${config.base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: basic(config.client) }, body: new URLSearchParams(form).toString() }, traceparent);

  const sessionOf = (ws) => {
    const s = sessions.get(ws);
    if (!s) return null;
    if (s.expiresAt <= now()) { sessions.delete(ws); return null; }
    return s;
  };
  const userOf = (s) => ({ sub: str(s.idClaims?.sub ?? s.claims?.sub, 120), name: str(s.idClaims?.preferred_username ?? s.idClaims?.name ?? s.idClaims?.email ?? config.username, 200), expiresAt: new Date(s.expiresAt).toISOString() });

  // The pi.flow sign-in. password: what the person typed (a string). Returns { ok: true, user, steps, tokens } or
  // { ok: false, status, error, message, steps }. PingOne drives the flows API password step; PingFederate asks the
  // IdP for the same and expects COMPLETED (the owner's sign-on policy does the password step in the IdP UI when it
  // is not a direct grant — this lab drives the API the same way customer-agent-LAB does, PingOne-shaped, and the
  // fake tests both providers' shared OAuth legs).
  async function signIn(ws, password, traceparentIn) {
    if (!configured()) throw new RealRefused('not_configured', config.problem, 503);
    if (inFlight >= MAX_IN_FLIGHT) throw new RealRefused('busy', 'two Real sign-ins are already in flight; wait for one to finish', 429);
    if (!sessions.has(ws) && sessions.size >= MAX_SESSIONS) throw new RealRefused('too_many', 'too many signed-in workspaces; Reset one first', 429);
    inFlight += 1;
    const traceId = randomBytes(16).toString('hex');
    const tp = () => `${traceId}`;
    const steps = [];
    const jar = new Map();
    const keep = (cookies) => { for (const c of cookies) { const pair = String(c).split(';')[0]; const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1)); } };
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const shownCookie = () => [...jar].map(([k, v]) => `${k}=${short(v)}`).join('; ');
    let sent = false; // true once the password has gone to the IdP: from then on, only error codes are kept
    // Belt and braces: the exact password, if it ever appears in what is returned, is replaced (only when long enough to be unambiguous).
    const scrub = (v) => (password.length >= 4 ? JSON.parse(JSON.stringify(v).split(JSON.stringify(password).slice(1, -1)).join('[the password]')) : v);
    const fail = (status, error, message, r) => scrub({ ok: false, status, error, message, steps, ...(r ? { idp: sent ? p1Codes(r) : p1Error(r) } : {}) });
    try {
      // 1. authorize, pi.flow: the answer is JSON (a flow), not a redirect.
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(12).toString('base64url');
      const nonce = randomBytes(12).toString('base64url');
      const query = { response_type: 'code', client_id: config.client.id, redirect_uri: REDIRECT_URIS[config.provider] ?? REDIRECT_URIS.pingone, scope: SIGN_IN_SCOPES, response_mode: 'pi.flow', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, nonce };
      const t1 = tp();
      const a = await idp(`${config.base}/as/authorize?${new URLSearchParams(query)}`, { method: 'GET', headers: { accept: 'application/json' } }, t1);
      keep(a.cookies);
      steps.push({ step: 'authorize (response_mode=pi.flow, PKCE S256)', traceparent: t1, request: { method: 'GET', url: `${config.base}/as/authorize`, query: { ...query, state: short(state), nonce: short(nonce) } }, response: { status: a.status, body: a.json ? { id: str(a.json.id, 64), status: str(a.json.status, 64), ...(a.status === 200 ? {} : p1Error(a)) } : p1Error(a), 'set-cookie': a.cookies.map(maskCookie) } });
      if (a.unreachable) return fail(503, 'signin_unreachable', 'The IdP did not answer the sign-in. Check the network, or switch to Mock.', a);
      if (a.status !== 200 || !a.json || !FLOW_ID.test(String(a.json.id || ''))) return fail(502, 'signin_refused', `The IdP refused to start the sign-in (${failText(a)}).`, a);
      let flow = a.json;
      const flowId = a.json.id;
      if (flow.status !== 'USERNAME_PASSWORD_REQUIRED' && flow.status !== 'COMPLETED') return fail(409, 'signin_step_unsupported', 'The IdP asked for a sign-in step this lab does not drive (only username and password). Check the sign-on policy.');
      // 2. username and password, once (PingOne flows API).
      if (flow.status === 'USERNAME_PASSWORD_REQUIRED') {
        if (!plain(password, 256)) return fail(400, 'bad_password', 'type the password (1 to 256 characters)');
        const t2 = tp();
        sent = true;
        const r = await idp(`${config.base}/flows/${flowId}`, { method: 'POST', headers: { 'content-type': PW_TYPE, accept: '*/*', ...(jar.size ? { cookie: cookieHeader() } : {}) }, body: JSON.stringify({ username: config.username, password }) }, t2);
        keep(r.cookies);
        steps.push({ step: 'flows API: username and password', traceparent: t2, request: { method: 'POST', url: `${config.base}/flows/${flowId}`, headers: { 'content-type': PW_TYPE, cookie: shownCookie() }, body: { username: config.username, password: PASSWORD_SHOWN } }, response: { status: r.status, body: r.json && r.status === 200 ? { id: str(r.json.id, 64), status: str(r.json.status, 64) } : p1Codes(r) } });
        if (r.unreachable) return fail(503, 'signin_unreachable', 'The IdP did not answer the sign-in. Check the network, or switch to Mock.', r);
        if (r.status === 400 || r.status === 401) return fail(401, 'signin_rejected', 'The IdP did not accept the username or password.', r);
        if (r.status !== 200 || !r.json) return fail(502, 'signin_refused', `The IdP refused the sign-in (${failText(r)}).`, r);
        flow = r.json;
        if (flow.status !== 'COMPLETED') return fail(409, 'signin_step_unsupported', 'The IdP asked for a step after the password that this lab does not drive (for example MFA). Check the sign-on policy.');
      }
      // 3. the code: in the completed flow, or from resume with the flow's cookies.
      let code = str(flow.authorizeResponse?.code, 2000); let gotState = flow.authorizeResponse?.state;
      if (!code) {
        const t3 = tp();
        const r = await idp(`${config.base}/as/resume?flowId=${encodeURIComponent(flowId)}`, { method: 'GET', headers: { accept: 'application/json', ...(jar.size ? { cookie: cookieHeader() } : {}) } }, t3);
        steps.push({ step: 'resume: the authorization code', traceparent: t3, request: { method: 'GET', url: `${config.base}/as/resume?flowId=${flowId}`, headers: { cookie: shownCookie() } }, response: { status: r.status, body: r.json?.authorizeResponse ? { authorizeResponse: { code: short(r.json.authorizeResponse.code), state: short(r.json.authorizeResponse.state) } } : p1Codes(r) } });
        if (r.unreachable) return fail(503, 'signin_unreachable', 'The IdP did not answer the sign-in. Check the network, or switch to Mock.', r);
        code = str(r.json?.authorizeResponse?.code, 2000); gotState = r.json?.authorizeResponse?.state;
        if (r.status !== 200 || !code) return fail(502, 'signin_refused', `The IdP did not hand back an authorization code (${failText(r)}).`, r);
      }
      if (gotState !== state) return fail(502, 'signin_refused', 'The authorization code came back without the state the lab sent; the lab refuses it.');
      // 4. code for tokens (the client's secret in the Authorization header only).
      const t4 = tp();
      const tok = await tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URIS[config.provider] ?? REDIRECT_URIS.pingone }, t4);
      const at = typeof tok.json?.access_token === 'string' ? tok.json.access_token : null;
      steps.push({ step: "token: the code for the user's tokens", traceparent: t4, request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: 'authorization_code', code: short(code), code_verifier: '[the PKCE verifier, never shown]', redirect_uri: REDIRECT_URIS[config.provider] ?? REDIRECT_URIS.pingone } }, response: { status: tok.status, body: at ? { access_token: '[the user access token: in the token list]', id_token: tok.json.id_token ? '[decoded in the token list]' : null, token_type: str(tok.json.token_type), expires_in: Number.isFinite(tok.json.expires_in) ? tok.json.expires_in : null, scope: str(tok.json.scope) } : p1Codes(tok) } });
      if (tok.unreachable) return fail(503, 'signin_unreachable', 'The IdP did not answer the token exchange. Check the network, or switch to Mock.', tok);
      if (tok.status !== 200 || !at) return fail(502, 'signin_refused', `The IdP did not issue the user's tokens (${failText(tok)}).`, tok);
      const idClaims = typeof tok.json.id_token === 'string' ? decodeJwt(tok.json.id_token)?.claims ?? null : null;
      if (idClaims && idClaims.nonce !== nonce) return fail(502, 'signin_refused', 'The ID token does not carry the nonce the lab sent; the lab refuses it.');
      const dec = decodeJwt(at);
      const life = Number.isFinite(tok.json.expires_in) && tok.json.expires_in > 0 ? Math.min(tok.json.expires_in, 24 * 3600) : 3600;
      const session = { accessToken: at, header: dec?.header ?? null, claims: dec?.claims ?? null, idClaims, expiresAt: now() + life * 1000, steps };
      sessions.set(ws, session);
      const tokens = [{ label: 'user access token (REAL, from the pi.flow sign-in)', real: true, raw: at, header: session.header, claims: session.claims, notice: 'REAL token from your IdP, shown raw for teaching. It expires in minutes; secrets and your password are never shown.' }];
      return scrub({ ok: true, user: userOf(session), steps, tokens });
    } finally { inFlight -= 1; }
  }

  return {
    configured, problem: () => (configured() ? null : config.problem),
    username: () => (configured() ? config.username : null),
    provider: () => (configured() ? config.provider : null),
    hosts: () => (configured() ? [new URL(config.base).hostname] : []),
    signIn, session: sessionOf, signOut: (ws) => sessions.delete(ws), userOf,
  };
}
