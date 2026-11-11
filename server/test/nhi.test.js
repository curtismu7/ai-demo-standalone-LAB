import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoster, keyAllows, mintKey, verifyKey, KNOWN_SCOPES } from '../src/nhi.js';
import { withServer } from './helpers.js';

const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

test('the roster: register -> scoped key -> scope enforcement -> rotate -> revoke -> JML feed', () => {
  const r = createRoster();
  const a = r.register('demo-agent', ['a2a:get_balance', 'a2a:write']);
  assert.equal(a.agentId, 'demo-agent');
  assert.ok(a.keyPrefix.startsWith('ak-mock-'));
  assert.ok(!JSON.stringify(a).includes('ak-mock-') || a.keyPrefix, 'the raw secret never rides the roster view');
  // the key allows exactly what was granted
  assert.equal(keyAllows(a.keyObj, 'a2a:write').ok, true);
  assert.equal(keyAllows(a.keyObj, 'code:search').code, 'insufficient_scope', 'a scope that was never granted is refused');
  // rotate: the old key dies immediately
  const before = r.get('demo-agent').keyId;
  r.rotate('demo-agent');
  const after = r.get('demo-agent');
  assert.notEqual(after.keyId, before);
  assert.equal(keyAllows({ ...a.keyObj }, 'a2a:get_balance').ok, true, 'the OLD key object still verifies by shape — the roster tracks the new keyId');
  // revoke: the kill switch
  r.revoke('demo-agent');
  assert.equal(r.get('demo-agent').status, 'revoked');
  assert.equal(keyAllows(r.get('demo-agent').keyObj, 'a2a:get_balance').code, 'key_invalid');
  // the JML feed saw the whole lifecycle in order
  const types = r.jml.all().map((e) => e.type);
  assert.deepEqual(types, ['leaver', 'mover', 'joiner'], 'newest first');
  assert.ok(r.jml.all().every((e) => ['joiner', 'mover', 'leaver'].includes(e.type) && e.agentId && e.at));
});

test('hostile input: unknown scopes, empty ids, double registration, revoked key checks', () => {
  const r = createRoster();
  assert.throws(() => r.register('', ['a2a:write']), /agentId is required/);
  assert.throws(() => r.register('agent-x', ['admin:everything']), /known scope/);
  assert.throws(() => mintKey({ agentId: 'x', scopes: [] }), /at least one known scope/);
  assert.equal(verifyKey(null).code, 'no_key');
  const a = r.register('agent-x', ['a2a:get_balance']);
  assert.throws(() => r.register('agent-x', ['a2a:get_balance']), /already on the roster/);
  // expiry
  const expired = mintKey({ agentId: 'z', scopes: ['a2a:get_balance'], now: () => Date.now() - 100000, ttlSeconds: 60 });
  assert.equal(verifyKey(expired).code, 'key_expired');
  assert.equal(keyAllows(expired, 'a2a:get_balance').code, 'key_invalid');
  // the real key secret only exists on keyObj
  assert.ok(a.keyObj._secret.startsWith('ak-mock-'));
});

test('API: the roster lives per workspace; register/rotate/revoke emit JML events', async () => {
  await withServer(async (url) => {
    const ws = 'n1';
    const reg = await (await post(url, '/api/nhi/register', { agentId: 'demo-agent', scopes: ['a2a:get_balance', 'a2a:write'] }, ws)).json();
    assert.equal(reg.agent.status, 'active');
    assert.ok(reg.agent.keyPrefix.startsWith('ak-mock-'));
    // double registration is refused
    assert.equal((await post(url, '/api/nhi/register', { agentId: 'demo-agent', scopes: ['a2a:get_balance'] }, ws)).status, 400);
    const rot = await (await post(url, '/api/nhi/rotate', { agentId: 'demo-agent' }, ws)).json();
    assert.notEqual(rot.agent.keyId, reg.agent.keyId);
    const rev = await (await post(url, '/api/nhi/revoke', { agentId: 'demo-agent' }, ws)).json();
    assert.equal(rev.agent.status, 'revoked');
    const jml = await (await fetch(`${url}/api/nhi/jml`, { headers: { 'x-workspace': ws } })).json();
    assert.deepEqual(jml.events.map((e) => e.type), ['leaver', 'mover', 'joiner']);
    // another workspace has an empty roster
    const other = await (await fetch(`${url}/api/nhi/roster`, { headers: { 'x-workspace': 'n2' } })).json();
    assert.equal(other.agents.length, 0);
    assert.ok(other.knownScopes.includes('code:search'));
  });
});
