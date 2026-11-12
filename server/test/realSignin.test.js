import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { startFakePingOne, USER_CLIENT_ID, USER_CLIENT_SECRET, DEMO_USERNAME, DEMO_PASSWORD, ENV_ID } from './fakePingone.js';

const post = (url, p, body, ws = 'si-probe') => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
const get = (url, p, ws = 'si-probe') => fetch(url + p, { headers: { origin: url, 'x-workspace': ws } });

const envFor = (fake) => ({
  AIDEMOLAB_SIGNIN_PROVIDER: 'pingone',
  AIDEMOLAB_SIGNIN_CLIENT_ID: USER_CLIENT_ID,
  AIDEMOLAB_SIGNIN_CLIENT_SECRET: USER_CLIENT_SECRET,
  AIDEMOLAB_SIGNIN_USERNAME: DEMO_USERNAME,
  PINGONE_ENVIRONMENT_ID: ENV_ID,
  AIDEMOLAB_SIGNIN_TEST_BASE: fake.base,
});

const postWithEnv = async (t, url, path, body) => t.context.serverPost(url, path, body);

test('P10 sign-in: the pi.flow ceremony against a fake PingOne, tokens, sign-out', async (t) => {
  const fake = await startFakePingOne();
  t.after(() => fake.close());
  await withServer(async (url) => {
    // unavailable without the sign-in settings? This server instance has them — check availability first
    const info = await (await get(url, '/api/signin')).json();
    assert.equal(info.method, 'pi.flow');
    // wrong password is a 401 with fixed text, no echo of what was typed
    const bad = await post(url, '/api/signin', { password: 'wrong-password-123' });
    assert.equal(bad.status, 401);
    const badBody = await bad.json();
    assert.equal(badBody.error, 'signin_rejected');
    assert.equal(badBody.steps.length, 2); // authorize + the password step
    // the fake echoes its own fixed message; the point is no password travels back
    assert.equal(JSON.stringify(badBody).includes('wrong-password-123'), false);

    // the real sign-in
    const ok = await post(url, '/api/signin', { password: DEMO_PASSWORD });
    assert.equal(ok.status, 200);
    const okBody = await ok.json();
    assert.equal(okBody.signedIn, true);
    assert.equal(okBody.user.name, DEMO_USERNAME);
    assert.equal(okBody.steps.length, 3); // authorize, password, token (the code came back in the completed flow, no resume)
    assert.equal(okBody.tokens.length, 1);
    assert.equal(okBody.tokens[0].real, true);
    assert.equal(typeof okBody.tokens[0].raw, 'string');
    assert.ok(okBody.tokens[0].raw.split('.').length === 3);
    assert.equal(JSON.stringify(okBody.steps).includes(DEMO_PASSWORD), false);

    // signed-in state
    const me = await (await get(url, '/api/signin')).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.user.sub, okBody.user.sub);

    // sign-out clears it
    const out = await post(url, '/api/signout', {});
    assert.equal(out.status, 200);
    const after = await (await get(url, '/api/signin')).json();
    assert.equal(after.signedIn, false);

    // a replayed password does not sign in twice behind one workspace: sign in again works (a fresh session)
    const again = await post(url, '/api/signin', { password: DEMO_PASSWORD });
    assert.equal(again.status, 200);
  }, { env: envFor(fake) });
});

test('P10 sign-in: unavailable (409 + GET available:false) when the .env has no sign-in settings, and no external call is made', async (t) => {
  await withServer(async (url) => {
    const info = await (await get(url, '/api/signin')).json();
    assert.equal(info.available, false);
    assert.match(info.reason, /AIDEMOLAB_SIGNIN_CLIENT_ID/);
    const r = await post(url, '/api/signin', { password: 'whatever-1' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'real_not_available');
  }, { env: {} });
});

test('P10 sign-in: a bad password length is a 400 before any IdP call', async (t) => {
  const fake = await startFakePingOne();
  t.after(() => fake.close());
  await withServer(async (url) => {
    const r = await post(url, '/api/signin', { password: '' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'bad_password');
    const long = await post(url, '/api/signin', { password: 'x'.repeat(257) });
    assert.equal(long.status, 400);
    assert.equal(fake.seen.length, 0); // nothing reached the IdP
  }, { env: envFor(fake) });
});

test('P10 PingFederate: the same pi.flow ceremony against AIDEMOLAB_SIGNIN_BASE_URL (login only)', async (t) => {
  const fake = await startFakePingOne();
  t.after(() => fake.close());
  const env = {
    AIDEMOLAB_SIGNIN_PROVIDER: 'pingfederate',
    AIDEMOLAB_SIGNIN_CLIENT_ID: USER_CLIENT_ID,
    AIDEMOLAB_SIGNIN_CLIENT_SECRET: USER_CLIENT_SECRET,
    AIDEMOLAB_SIGNIN_USERNAME: DEMO_USERNAME,
    AIDEMOLAB_SIGNIN_BASE_URL: `http://127.0.0.1:${fake.port}/${ENV_ID}`,
  };
  await withServer(async (url) => {
    const info = await (await get(url, '/api/signin')).json();
    assert.equal(info.provider, 'pingfederate');
    assert.equal(info.available, true);
    const ok = await post(url, '/api/signin', { password: DEMO_PASSWORD });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.signedIn, true);
    assert.equal(body.tokens[0].real, true);
  }, { env });
});
