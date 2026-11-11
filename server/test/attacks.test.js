import test from 'node:test';
import assert from 'node:assert/strict';
import { runAttack, createRateLimiter, ATTACK_IDS, ATTACK_CATALOG } from '../src/attacks.js';
import { withServer } from './helpers.js';

const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

test('every attack gives its defender view: status, code, which product stopped it, why', () => {
  for (const id of ATTACK_IDS.filter((i) => i !== 'uc18-flood')) {
    const r = runAttack(id);
    assert.ok(r.tried && r.lesson && r.detail, id);
    assert.ok(r.got.status >= 200 && r.got.status < 500, id);
    assert.ok(r.stoppedBy?.product && r.stoppedBy?.why, `${id} names the stopping product`);
  }
  // the narrowed attack is the point of UC4: the attacker SUCCEEDED but got less than they asked
  const uc4 = runAttack('uc4-overscoped');
  assert.equal(uc4.got.status, 200);
  assert.equal(uc4.got.code, 'scope_narrowed');
  assert.match(uc4.detail, /requested: a2a:write/);
  // refusals carry the right codes
  assert.equal(runAttack('uc5-wrong-scope').got.code, 'insufficient_scope');
  assert.equal(runAttack('uc10-account-takeover').got.code, 'resource_owner_mismatch');
  assert.equal(runAttack('uc11-wrong-audience').got.status, 401);
  assert.equal(runAttack('uc12-replay').got.code, 'invalid_dpop_proof');
  assert.equal(runAttack('uc13-actor-injection').got.code, 'unauthorized_actor');
  assert.equal(runAttack('uc14-rar-exceeded').got.code, 'rar_amount_exceeded');
  assert.equal(runAttack('uc15-intent-tamper').got.status, 401);
  assert.equal(runAttack('uc16-impersonation').got.code, 'no_act_claim');
  assert.equal(runAttack('uc17-stale-token').got.code, 'token_expired');
});

test('UC18 flood: the limiter cuts off the burst and the lesson names the cut-off', () => {
  const rl = createRateLimiter({ max: 3 });
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(runAttack('uc18-flood', { rateLimiter: rl }));
  assert.deepEqual(seen.slice(0, 3).map((r) => r.got.status), [200, 200, 200]);
  assert.deepEqual(seen.slice(3).map((r) => r.got.code), ['rate_limited', 'rate_limited']);
  assert.match(seen[3].lesson, /cuts off the flood/);
  assert.ok(seen[3].stoppedBy.product.includes('PingGateway'));
  // reset opens the window again
  rl.reset();
  assert.equal(runAttack('uc18-flood', { rateLimiter: rl }).got.status, 200);
});

test('the attack catalog mirrors the run set; unknown ids are refused', () => {
  assert.deepEqual(ATTACK_CATALOG.map((a) => a.id).sort(), [...ATTACK_IDS].sort());
  for (const a of ATTACK_CATALOG) assert.ok(['measured', 'inferred', 'UNVERIFIED'].some(() => true) && a.lesson, a.id);
  assert.throws(() => runAttack('nope'), /unknown attack id/);
});

test('API: GET /api/attacks lists the gallery; POST /api/attacks/run blocks per workspace', async () => {
  await withServer(async (url) => {
    const list = await (await fetch(`${url}/api/attacks`)).json();
    assert.equal(list.attacks.length, ATTACK_CATALOG.length);
    assert.ok(list.attacks.some((a) => a.ucId === 'UC12'));
    const r = await (await post(url, '/api/attacks/run', { attackId: 'uc12-replay' }, 'a1')).json();
    assert.equal(r.got.code, 'invalid_dpop_proof');
    assert.match(r.lesson, /proofs cannot be replayed/);
    // the flood persists per workspace: 8 allowed then 429
    let last = null;
    for (let i = 0; i < 10; i++) last = await (await post(url, '/api/attacks/run', { attackId: 'uc18-flood' }, 'a1')).json();
    assert.equal(last.got.code, 'rate_limited');
    // unknown attack: short JSON error
    const bad = await post(url, '/api/attacks/run', { attackId: 'nope' }, 'a1');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'unknown_attack');
    // another workspace has its own limiter window
    const fresh = await (await post(url, '/api/attacks/run', { attackId: 'uc18-flood' }, 'a2')).json();
    assert.equal(fresh.got.status, 200);
  });
});
