// P3: /api/assistant/turn's run now carries the demo-hop/1 hops and the raw MOCK token
// cards. Shapes asserted (values vary per run): hops carry n/kind/from/to/verdict plus
// the demo-hop fields; tokens carry id/title/role/mock/claims and the delegated diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/vendor/hop-catalog.json', import.meta.url), 'utf8'));
const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

test('assistant turn: the run carries demoHops and tokens, top level and on the run', async () => {
  await withServer(async (url) => {
    const r = await (await post(url, '/api/assistant/turn', { message: 'check my balance with my consent' }, 'p3')).json();
    assert.equal(r.handling, 'in-app');
    assert.ok(Array.isArray(r.run.demoHops) && r.run.demoHops.length >= 8, 'the run carries the demo hops');
    assert.ok(Array.isArray(r.demoHops), 'the top-level payload carries them too');
    assert.ok(Array.isArray(r.run.tokens10) && r.run.tokens10.length === 3, 'the run carries the three token cards');
    // every demo hop validates against the vendored catalog (Mock: tokens raw)
    for (const h of r.run.demoHops) {
      assert.deepEqual(validateHop(h, catalog, { tokens: 'raw' }), [], `hop ${h.n} (${h.kind})`);
      assert.ok(h.title && h.fact && h.spec, `hop ${h.n} is enriched`);
    }
    // existing fields all still ride
    assert.ok(r.run.hops?.length, 'the teaching hops are unchanged');
    assert.ok(r.run.narrative && r.run.lesson && r.run.products, 'the teaching layer is unchanged');
    assert.ok(r.run.traceId && r.run.decision === 'PERMIT');
    // token card shape
    for (const t of r.run.tokens10) {
      assert.ok(t.id && t.title && t.role && t.mock === true && t.claims, `token card ${t.id}`);
      assert.equal(typeof t.claims, 'object');
    }
    const delegated = r.run.tokens10.find((t) => t.id === 'delegated-token');
    assert.ok(delegated.diff, 'the delegated card carries a diff');
    assert.ok(Array.isArray(delegated.diff.added) && Array.isArray(delegated.diff.rebound) && Array.isArray(delegated.diff.narrowed));
    // the OBLIGATION run carries them too
    const pause = await (await post(url, '/api/assistant/turn', { message: 'mfa step up for my transfer of 600' }, 'p3')).json();
    assert.equal(pause.decision, 'OBLIGATION');
    assert.ok(pause.run.demoHops.some((h) => h.verdict === 'obligation'), 'an obligation run carries obligation hops');
    assert.ok(pause.run.tokens10.length === 3);
    // redirect and unknown carry no run (unchanged)
    const u = await (await post(url, '/api/assistant/turn', { message: 'tell me a joke' }, 'p3b')).json();
    assert.equal(u.demoHops, undefined);
    assert.equal(u.tokens10, undefined);
  });
});
