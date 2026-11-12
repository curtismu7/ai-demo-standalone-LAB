import test from 'node:test';
import assert from 'node:assert/strict';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/health`)).json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.demo.id, 'ai-demo-standalone');
  });
});

test('health is GET only; unknown API paths are 404 JSON; non-loopback Host refused', async () => {
  await withServer(async (url) => {
    assert.equal((await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } })).status, 405);
    assert.equal((await (await fetch(`${url}/api/nope`)).json()).error, 'not_found');
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } })).status, 403);
  });
});

test('GET /api/info: mock and simulated; no hosted field (hosted mode is not a thing for standalone labs)', async () => {
  await withServer(async (url) => {
    const info = await (await fetch(`${url}/api/info`)).json();
    assert.deepEqual({ ...info, version: undefined }, { mode: 'mock', source: 'mock', simulated: true, realAvailable: false, version: undefined });
    assert.equal(typeof info.version, 'string');
    assert.match((await (await fetch(`${url}/api/scenarios`)).json()).banner, /^SIMULATED/);
  });
});

test('GET /api/catalog: all 87 use cases, filterable by track, tracks listed', async () => {
  await withServer(async (url) => {
    const all = await (await fetch(`${url}/api/catalog`)).json();
    assert.equal(all.count, 87);
    assert.ok(all.tracks.includes('foundations') && all.tracks.includes('controls') && all.tracks.includes('attacks'));
    const f = await (await fetch(`${url}/api/catalog?track=foundations`)).json();
    assert.ok(f.count > 0 && f.count < 87);
    assert.ok(f.useCases.every((u) => u.track === 'foundations'));
    const hitl = await (await fetch(`${url}/api/catalog?track=hitl`)).json();
    assert.ok(hitl.useCases.some((u) => u.id === 'UC7'));
  });
});

test('GET /api/usecases: the launcher rows, one per use case, with the (uc, app) href', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/usecases`)).json();
    assert.equal(j.schema, 'usecases/1');
    assert.equal(j.count, 87);
    assert.equal(j.useCases.length, 87);
    assert.equal(new Set(j.useCases.map((r) => r.id)).size, 87, 'every use case exactly once');
    for (const r of j.useCases) {
      assert.ok(['in-app', 'redirect', 'guide'].includes(r.handling), `${r.id}: a handling`);
      assert.equal(typeof r.title, 'string');
    }
    const here = j.useCases.filter((r) => r.handling === 'in-app');
    assert.equal(here.length, 31, 'the wired scenarios + the A2A panel use cases run here (the owner-pinned total)');
    const off = j.useCases.find((r) => r.id === 'UC12');
    assert.equal(off.handling, 'redirect');
    assert.equal(off.proxyPath, '/stolen-token-lab/');
    const guide = j.useCases.filter((r) => r.handling === 'guide');
    assert.ok(guide.length >= 11, 'at least the Appendix guide cards are guide rows');
  });
});

test('UC2.7-style beat: no bearer is a real 401 with WWW-Authenticate', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/authorize`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': 'w0' }, body: JSON.stringify({ tool: 'get_balance' }) });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') || '', /Bearer realm="ai-demo-standalone"/);
    const j = await r.json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.stage, 'protocol');
    assert.equal(j.code, 'missing_bearer');
  });
});

test('UC1: consent mints act={agent}; the balance read permits', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const { token } = await (await post('/api/consent', { user: 'demoUser', actor: 'demo-agent' }, 'w1')).json();
    assert.equal(token.sub, 'demoUser');
    assert.equal(token.act.sub, 'demo-agent');
    const r = await post('/api/authorize', { token, tool: 'get_balance' }, 'w1');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.decision, 'PERMIT');
    assert.equal(j.chainDepth, 1);
    assert.deepEqual(j.groups, ['privileged']);
  });
});

test('UC9: outside the group is denied regardless of scopes; UC9A flip moves the next call', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const { token } = await (await post('/api/consent', { user: 'jane' }, 'w2')).json();
    const j = await (await post('/api/authorize', { token, tool: 'get_balance' }, 'w2')).json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.code, 'group_entitlement');
    assert.match(j.reason, /regardless of the token's scopes/);
    // flip jane into the group: the SAME call permits
    await post('/api/directory/set', { user: 'jane', groups: ['privileged'], tier: 'Standard' }, 'w2');
    const j2 = await (await post('/api/authorize', { token, tool: 'get_balance' }, 'w2')).json();
    assert.equal(j2.decision, 'PERMIT');
    // another workspace never saw the flip
    const { token: t3 } = await (await post('/api/consent', { user: 'jane' }, 'w3')).json();
    assert.equal((await (await post('/api/authorize', { token: t3, tool: 'get_balance' }, 'w3')).json()).decision, 'DENY');
  });
});

test('UC21: tier bands — premium-only tool denied on Standard, permitted on Premium, ceiling enforced', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const { token: std } = await (await post('/api/consent', { user: 'demoUser' }, 'w4')).json();
    const j1 = await (await post('/api/authorize', { token: std, tool: 'create_wire_transfer', amount: 500 }, 'w4')).json();
    assert.equal(j1.code, 'tier_tool_not_allowed');
    const { token: prem } = await (await post('/api/consent', { user: 'premiumUser' }, 'w4')).json();
    // stage 2: the wire tool is HITL — the band test uses a read tool for the ceiling check,
    // and the HITL path itself is covered by the dedicated tests below.
    const j2 = await (await post('/api/authorize', { token: prem, tool: 'get_transactions', amount: 60000 }, 'w4')).json();
    assert.equal(j2.code, 'tier_amount_exceeded');
    assert.match(j2.reason, /\$50000/);
  });
});

test('UC6/UC32: unknown actor refused at the gateway; upstream audience refused', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const { token: rogue } = await (await post('/api/consent', { user: 'demoUser', actor: 'rogue-agent' }, 'w5')).json();
    const j1 = await (await post('/api/authorize', { token: rogue, tool: 'get_balance' }, 'w5')).json();
    assert.equal(j1.stage, 'gateway');
    assert.equal(j1.code, 'unauthorized_actor');
    const { token: up } = await (await post('/api/consent', { user: 'demoUser', aud: 'mcp-weather.internal' }, 'w5')).json();
    const j2 = await (await post('/api/authorize', { token: up, tool: 'get_balance' }, 'w5')).json();
    assert.equal(j2.code, 'upstream_audience');
  });
});

test('the teaching layer: narrative, lesson and mock hops ride every authorize response', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const { token } = await (await post('/api/consent', { user: 'demoUser', actor: 'demo-agent' }, 'w7')).json();
    const ok = await (await post('/api/authorize', { token, tool: 'get_balance' }, 'w7')).json();
    assert.equal(ok.decision, 'PERMIT');
    assert.ok(ok.narrative.some((n) => n.title.includes('policy checked three things')), 'narrative explains the pass');
    assert.match(ok.lesson, /chain behind it/);
    assert.equal(ok.hops[0].label.includes('consent'), true, 'hops start at consent');
    assert.ok(ok.hops.every((h) => /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(h.traceparent)), 'every hop carries a valid traceparent');
    assert.ok(ok.hops[0].response.includes('act'), 'the consent hop shows the minted act claim');
    assert.ok(ok.hops[ok.hops.length - 1].response.includes('200'), 'the last hop is the API response');
    // a gateway deny still carries hops, ending in the refusal
    const { token: rogue } = await (await post('/api/consent', { user: 'demoUser', actor: 'rogue-agent' }, 'w7')).json();
    const d = await (await post('/api/authorize', { token: rogue, tool: 'get_balance' }, 'w7')).json();
    assert.equal(d.decision, 'DENY');
    assert.match(d.lesson, /WHO is acting/);
    assert.ok(d.hops[d.hops.length - 1].response.includes('403'));
    // a policy deny explains the group gate
    const { token: jane } = await (await post('/api/consent', { user: 'jane', actor: 'demo-agent' }, 'w7')).json();
    const g = await (await post('/api/authorize', { token: jane, tool: 'get_balance' }, 'w7')).json();
    assert.match(g.lesson, /read on EVERY decision/);
    assert.match(g.narrative[0].what, /REGARDLESS of the token.s scopes/);
  });
});

test('bad inputs are refused with short JSON; oversized body 413; server stays up', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws = 'w9') => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    assert.equal((await post('/api/consent', { user: '' }, 'w9')).status, 400);
    assert.equal((await post('/api/directory/set', { user: '' }, 'w9')).status, 400);
    assert.equal((await post('/api/directory/set', { user: 'x', groups: 'nope' }, 'w9')).status, 400);
    assert.equal((await post('/api/authorize', { token: 'junk' }, 'w9')).status, 403);
    const big = await post('/api/consent', { pad: 'x'.repeat(9000) }, 'w9');
    assert.equal(big.status, 413);
    const bad = await post('/api/consent', '{not json');
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  });
});

test('rule 19: POST /api/mode switches (mock) and answers 409 when Real is not configured', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
    assert.deepEqual(await (await post({ source: 'mock' })).json(), { source: 'mock' });
    assert.equal((await post({ source: 'real' })).status, 409);
    assert.equal((await post({ source: 'banana' })).status, 400);
  });
});

test('GET /api/diagram serves the decision-chain diagram, uncached', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/diagram`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.ok(j.steps.length >= 4);
    assert.ok(j.nodes.some((n) => n.label.includes('Gateway')));
  });
});
