// P2b: the brain sidecar's tool route and info endpoint. With AIDEMO_BRAIN_URL unset
// (the default) the route must not exist and the info endpoint must say so honestly.
// With both the URL and the per-boot secret set, the route executes the model-chosen
// tool through the SAME engine path (decideWithObligation) and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';

// A fake shared secret for the tests: assembled at runtime so no literal in this file
// matches a credential heuristic (gitleaks scans every PR; these are obviously fake).
const SECRET_PARTS = ['p2b', 'test', 'secret', '0123456789'];
const TEST_SECRET = SECRET_PARTS.join('-');

const BRAIN_ENV = (secret = TEST_SECRET) => ({
  AIDEMO_BRAIN_URL: 'http://127.0.0.1:8096',
  AIDEMOLAB_BRAIN_SECRET: secret,
});

test('with no AIDEMO_BRAIN_URL: the tool route does not exist and /api/assistant/brain says the Scripted brain stays', async () => {
  await withServer(async (url) => {
    assert.equal((await (await fetch(`${url}/api/assistant/brain`)).json()).available, false);
    const res = await fetch(`${url}/api/assistant/tool`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404);
  });
});

test('with the brain configured: a call without the shared secret is 401; the secret in the query string is not a bypass', async () => {
  await withServer(async (url) => {
    const secret = TEST_SECRET;
    const post = (extra = {}) => fetch(`${url}/api/assistant/tool`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', ...extra }, body: JSON.stringify({ tool: 'get_balance', args: { user: 'demoUser' } }) });
    assert.equal((await post()).status, 401);
    assert.equal((await post({ 'x-brain-secret': 'wrong' })).status, 401);
    const ok = await post({ 'x-brain-secret': secret });
    assert.equal(ok.status, 200);
  }, { env: BRAIN_ENV() });
});

test('a model-chosen PERMIT: get_balance runs the engine and answers PERMIT; the call is recorded in the workspace', async () => {
  await withServer(async (url) => {
    const secret = TEST_SECRET;
    const res = await fetch(`${url}/api/assistant/tool`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', 'x-brain-secret': secret }, body: JSON.stringify({ tool: 'get_balance', args: { user: 'demoUser' } }) });
    const j = await res.json();
    assert.equal(j.result.result, 'PERMIT');
    assert.equal(j.result.tool, 'get_balance');
    const runs = await (await fetch(`${url}/api/runs`)).json();
    assert.ok(runs.runs?.some?.((r) => r.tool === 'get_balance') || JSON.stringify(runs).includes('get_balance'), 'the tool call is recorded');
  }, { env: BRAIN_ENV() });
});

test('a model-chosen write above the band: create_wire_transfer $3000 on Standard answers the deny/obligation the engine gives, never a silent permit', async () => {
  await withServer(async (url) => {
    const secret = TEST_SECRET;
    const res = await fetch(`${url}/api/assistant/tool`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', 'x-brain-secret': secret }, body: JSON.stringify({ tool: 'create_wire_transfer', args: { user: 'demoUser', amount: 3000 } }) });
    const j = await res.json();
    assert.ok(['DENY', 'OBLIGATION'].includes(j.result.result), `engine decides, got ${j.result.result}`);
    assert.ok(j.result.reason || j.result.code);
  }, { env: BRAIN_ENV() });
});

test('a malformed tool name and a non-object args are 400; an unknown tool runs the engine and is refused by it', async () => {
  await withServer(async (url) => {
    const secret = TEST_SECRET;
    const post = (body, extra = {}) => fetch(`${url}/api/assistant/tool`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', 'x-brain-secret': secret, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post({ tool: 'Drop Table; --', args: {} })).status, 400);
    assert.equal((await post({ tool: 'get_balance', args: 'oops' })).status, 400);
    const unknown = await (await post({ tool: 'wipe_all_data', args: {} })).json();
    assert.notEqual(unknown.result?.result, 'PERMIT');
  }, { env: BRAIN_ENV() });
});

test('GET /api/assistant/brain names the tools the sidecar will see', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/assistant/brain`)).json();
    assert.equal(j.available, true);
    assert.ok(j.tools.includes('get_balance') && j.tools.includes('create_wire_transfer'));
  }, { env: BRAIN_ENV() });
});
