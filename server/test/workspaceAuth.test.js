import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { createApp, startHttpServer } from '../src/app.js';
import fs from 'node:fs';
import { createHealth } from '../src/health.js';
import { mintWorkspaceToken, serverKey } from '../src/workspaces.js';

test('a workspace without a valid HMAC token is refused 401; the mint endpoint issues one', async () => {
  await withServer(async (url) => { /* auth on via appOpts */
    const noToken = await fetch(`${url}/api/directory`, { headers: { 'x-workspace': 'w-auth1' } });
    assert.equal(noToken.status, 401);
    const j = await noToken.json();
    assert.equal(j.error, 'workspace_token_required');
    // mint then use
    const minted = await (await fetch(`${url}/api/workspace`, { headers: { 'x-workspace': 'w-auth1' } })).json();
    assert.equal(minted.workspace, 'w-auth1');
    assert.ok(minted.token.length > 20);
    const ok = await fetch(`${url}/api/directory`, { headers: { 'x-workspace': 'w-auth1', 'x-workspace-token': minted.token } });
    assert.equal(ok.status, 200);
  }, { workspaceAuth: true });
});

test('a token minted for workspace A is worthless at workspace B; a forged token fails', async () => {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const key = serverKey({ AIDEMOLAB_SERVER_KEY: 'k'.repeat(32) });
  const { server, url: rawUrl } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile: '/nonexistent.json', workspaceAuth: true, wsKey: key }) });
  const url = rawUrl.replace(/\/$/, '');
  try {
    const tA = mintWorkspaceToken('w-a', key);
    const h1 = await fetch(`${url}/api/health`);
    await new Promise((r) => setTimeout(r, 300));
    const h2 = await fetch(`${url}/api/health`);
    console.log('DEBUG immediate:', h1.status, 'after300:', h2.status, 'url:', url);
    const cross = await fetch(`${url}/api/directory`, { headers: { 'x-workspace': 'w-b', 'x-workspace-token': tA } });
    console.log('DEBUG cross status:', cross.status, 'body:', (await cross.text()).slice(0, 80));
    assert.equal(cross.status, 401, 'token is bound to its workspace id');
    const forged = await fetch(`${url}/api/directory`, { headers: { 'x-workspace': 'w-a', 'x-workspace-token': 'forged-token' } });
    assert.equal(forged.status, 401);
    // same key restart: the token still verifies (paired with a durable store this survives restarts)
    const tA2 = mintWorkspaceToken('w-a', key);
    assert.equal(tA2, tA, 'deterministic for a fixed key');
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});
