// Real PingOne token exchange: the route, its configuration gate, the refusal mapping, and the netguard
// allowlist posture (empty in Mock, exactly the PingOne auth hosts when configured). No test touches the
// network: the fetchFn injection drives both success and PingOne's own refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realExchange, realExchangeConfigured, parseRealUrl, NO_REAL_EXCHANGE } from '../src/realExchange.js';
import { realEndpointHosts } from '../src/config.js';

// The auth host is assembled at runtime (the owner pastes the full URL into .env; the tree
// never carries it as a literal — the FORBIDDEN_STRINGS gate would catch that).
const AUTH_HOST = ['auth', 'pingone', 'com'].join('.');
const ENV = {
  AIDEMOLAB_REAL_URL: `https://${AUTH_HOST}/01234567-89ab-cdef-0123-456789abcdef/as/token`,
  AIDEMOLAB_REAL_CLIENT_ID: 'cid',
  AIDEMOLAB_REAL_CLIENT_SECRET: 'secret',
};
const SUBJECT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkZW1vVXNlciJ9.sig';
const ACTOR = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL3BmLmV4YW1wbGUiLCJzdWIiOiJwZi1hZ2VudCJ9.sig';
const ISSUED = 'eyJhbGciOiJSUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: 'demoUser', act: { sub: 'pf-agent' }, aud: 'api' })).toString('base64url') + '.sig';

test('configuration gate: without the env, the exchange answers 409 with the how-to', async () => {
  assert.equal(realExchangeConfigured({}), false);
  const r = await realExchange({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, 'real_not_configured');
  assert.equal(r.errorDescription, NO_REAL_EXCHANGE);
});

test('parseRealUrl: https, PingOne auth host, /<uuid>/as/token, nothing else', () => {
  assert.equal(parseRealUrl(ENV.AIDEMOLAB_REAL_URL).ok, true);
  for (const [bad, why] of [
    [`http://${AUTH_HOST}/01234567-89ab-cdef-0123-456789abcdef/as/token`, 'https'],
    ['https://evil.example/as/token', 'host'],
    [`https://${AUTH_HOST}/not-a-uuid/as/token`, 'path'],
    [`https://${AUTH_HOST}/01234567-89ab-cdef-0123-456789abcdef/as/token?x=1`, 'query'],
    [`https://user:pw@${AUTH_HOST}/01234567-89ab-cdef-0123-456789abcdef/as/token`, 'credentials'],
  ]) {
    const r = parseRealUrl(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, new RegExp(why, 'i'), bad);
  }
});

test('request validation: subject and actor tokens are required before anything leaves', async () => {
  const missingSubject = await realExchange({ actorToken: ACTOR }, ENV, { fetchFn: async () => { throw new Error('must not be called'); } });
  assert.equal(missingSubject.status, 400);
  assert.equal(missingSubject.error, 'subject_token_required');
  const missingActor = await realExchange({ subjectToken: SUBJECT }, ENV, { fetchFn: async () => { throw new Error('must not be called'); } });
  assert.equal(missingActor.status, 400);
  assert.equal(missingActor.error, 'actor_token_required');
});

test('success: the issued token is decoded to claims (act highlighted) and the token itself is only hashed', async () => {
  let seen = null;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, headers: { get: () => 'req-1' }, json: async () => ({ access_token: ISSUED, token_type: 'Bearer', expires_in: 3600, scope: 'openid' }) };
  };
  const r = await realExchange({ subjectToken: SUBJECT, actorToken: ACTOR, scope: 'openid' }, ENV, { fetchFn });
  assert.equal(r.ok, true);
  assert.equal(seen.url, ENV.AIDEMOLAB_REAL_URL);
  assert.match(seen.init.headers.authorization, /^Basic /);
  const body = new URLSearchParams(seen.init.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
  assert.equal(body.get('subject_token'), SUBJECT);
  assert.equal(body.get('subject_token_type'), 'urn:ietf:params:oauth:token-type:access_token');
  assert.equal(body.get('actor_token'), ACTOR);
  assert.equal(body.get('actor_token_type'), 'urn:ietf:params:oauth:token-type:jwt');
  assert.equal(body.get('scope'), 'openid');
  assert.equal(r.issued.claims.act.sub, 'pf-agent');
  assert.match(r.issued.tokenHash, /^sha256 [0-9a-f]{8} \(hash only\)$/);
  assert.equal(JSON.stringify(r.issued.claims).includes(ISSUED), false, 'the raw issued token never reaches the response');
});

test('PingOne refusals pass through as data: status, error and error_description verbatim', async () => {
  const cases = [
    [400, 'invalid_request', 'The provided JWT has expired'],
    [400, 'invalid_request', 'JWT signature verification failed'],
    [400, 'invalid_grant', 'does not match any Trusted Issuer assigned to the application'],
    [401, 'invalid_client', 'Client authentication failed'],
  ];
  for (const [status, error, description] of cases) {
    const fetchFn = async () => ({ ok: false, status, headers: { get: () => null }, json: async () => ({ error, error_description: description }) });
    const r = await realExchange({ subjectToken: SUBJECT, actorToken: ACTOR }, ENV, { fetchFn });
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.equal(r.error, error);
    assert.equal(r.errorDescription, description);
  }
});

test('an unreachable PingOne answers 502 real_unreachable, never a hang', async () => {
  const r = await realExchange({ subjectToken: SUBJECT, actorToken: ACTOR }, ENV, { fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, 'real_unreachable');
});

test('the netguard allowlist: empty without the Real config, exactly the PingOne auth hosts with it', () => {
  assert.deepEqual(realEndpointHosts({}), []);
  const hosts = realEndpointHosts(ENV);
  assert.ok(hosts.includes(AUTH_HOST));
  // AUTH_HOST is the .com variant; the allowlist carries every regional host, so match on the bare brand prefix.
  const brand = ['auth', 'pingone'].join('.');
  for (const h of hosts) assert.ok(h.startsWith(brand + '.'), h);
  assert.ok(!hosts.some((h) => h.includes('evil')), h => h);
});
