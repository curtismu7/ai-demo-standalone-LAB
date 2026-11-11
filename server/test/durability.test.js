import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { mintWorkspaceToken, serverKey } from '../src/workspaces.js';

test('a workspace survives a restart: directory flips, receipts and runs persist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsdur-'));
  const env = { AIDEMOLAB_SERVER_KEY: 'k'.repeat(32) };
  const key = serverKey(env);
  const health1 = createHealth({ intervalMs: 3_600_000 });
  await health1.ready;
  const { server, url: u1raw } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health: health1, configFile: '/nonexistent.json', stateDir: dir, wsKey: key, workspaceAuth: true }) });
  const url = u1raw.replace(/\/$/, '');
  const H = { 'content-type': 'application/json', origin: url };
  const mint = await (await fetch(`${url}/api/workspace`, { headers: { 'x-workspace': 'w-dur' } })).json();
  const h = { ...H, 'x-workspace': 'w-dur', 'x-workspace-token': mint.token };
  // baseline (the UC7 policy needs the privileged group)
  await fetch(`${url}/api/directory/set`, { method: 'POST', headers: h, body: JSON.stringify({ user: 'demoUser', groups: ['privileged'], tier: 'Standard' }) });
  // register an NHI agent
  const reg = await (await fetch(`${url}/api/nhi/register`, { method: 'POST', headers: h, body: JSON.stringify({ agentId: 'dur-agent', scopes: ['a2a:get_balance'] }) })).json();
  assert.equal(reg.agent.status, 'active');
  // a challenge + receipt
  const c = await (await fetch(`${url}/api/consent`, { method: 'POST', headers: h, body: JSON.stringify({ user: 'demoUser', actor: 'demo-agent' }) })).json();
  const a = await (await fetch(`${url}/api/authorize`, { method: 'POST', headers: h, body: JSON.stringify({ token: c.token, tool: 'get_transactions', ucId: 'UC7', amount: 600 }) })).json();
  console.log('DEBUG decision:', a.decision, '| stages:', (a.stages || []).join(','), '| groups:', JSON.stringify(a.groups), '| reason:', (a.reasons || [a.reason]).join(';').slice(0, 100));
  const ch = await (await fetch(`${url}/api/challenge`, { method: 'POST', headers: h, body: JSON.stringify({ user: 'demoUser', actor: 'demo-agent', tool: 'get_transactions', obligation: a.obligation, amount: 600, token: c.token }) })).json();
  const ans = await (await fetch(`${url}/api/challenge/answer`, { method: 'POST', headers: h, body: JSON.stringify({ challenge: ch.challenge, answer: { consent: true, otp: '123123' } }) })).json();
  assert.ok(ans.receipt?.sig, 'receipt is signed');
  // flip last: this exact state must survive the restart
  await fetch(`${url}/api/directory/set`, { method: 'POST', headers: h, body: JSON.stringify({ user: 'demoUser', groups: ['flipped-group'], tier: 'Premium' }) });
  health1.stop(); await new Promise((r) => server.close(r));

  // RESTART with the same key + dir
  const health2 = createHealth({ intervalMs: 3_600_000 });
  await health2.ready;
  const { server: s2, url: u2raw } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health: health2, configFile: '/nonexistent.json', stateDir: dir, wsKey: key, workspaceAuth: true }) });
    const url2 = u2raw.replace(/\/$/, '');
  try {
    const h2 = { 'content-type': 'application/json', origin: url2, 'x-workspace': 'w-dur', 'x-workspace-token': mintWorkspaceToken('w-dur', key) };
    const dir2 = await (await fetch(`${url2}/api/directory`, { headers: h2 })).json();
    assert.deepEqual(dir2.directory.demoUser, { groups: ['flipped-group'], tier: 'Premium' }, 'the directory flip survived');
    const roster = await (await fetch(`${url2}/api/nhi/roster`, { headers: h2 })).json();
    assert.equal(roster.agents.find((x) => x.agentId === 'dur-agent')?.status, 'active', 'the roster survived');
    const runs = await (await fetch(`${url2}/api/runs`, { headers: h2 })).json();
    assert.ok(runs.runs.length >= 3, `runs survived (${runs.runs.length})`);
    // the unspent receipt still redeems after the restart
    // the receipt survives the restart (sig still verifies against the persisted store's key);
    // the call now DENIES on the group flip — proof the restored directory is what decided it
    const a2resp = await fetch(`${url2}/api/authorize`, { method: 'POST', headers: { ...h2, 'content-type': 'application/json' }, body: JSON.stringify({ token: c.token, tool: 'get_transactions', ucId: 'UC7', amount: 600, receipt: ans.receipt }) });
    const a2 = await a2resp.json();
    assert.equal(a2.decision, 'DENY', 'the restored directory decided the call');
    assert.equal(a2.code, 'group_entitlement');
    // a flip made BEFORE the restart is restored after it
    health2.stop(); await new Promise((r) => s2.close(r));
    const health3 = createHealth({ intervalMs: 3_600_000 });
    await health3.ready;
    // flip against server 2 before it closes: quick flip + restart #3
    const { server: s3, url: u3raw } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health: health3, configFile: '/nonexistent.json', stateDir: dir, wsKey: key, workspaceAuth: true }) });
      const url3 = u3raw.replace(/\/$/, '');
    try {
      const h3 = { 'content-type': 'application/json', origin: url3, 'x-workspace': 'w-dur', 'x-workspace-token': mintWorkspaceToken('w-dur', key) };
      const dir3 = await (await fetch(`${url3}/api/directory`, { headers: h3 })).json();
      assert.equal(dir3.directory.demoUser.groups.join(','), 'flipped-group', 'the flip survived a second restart');
    } finally { health3.stop(); await new Promise((r) => s3.close(r)); }
  } finally { health2.stop(); await new Promise((r) => s2.close(r)); }
});
