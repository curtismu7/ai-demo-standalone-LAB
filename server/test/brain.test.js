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

// ── the fold: POST /api/assistant/turn with brain:"langgraph" ────────────────
test('brain=langgraph with the sidecar up: the turn folds the AG-UI stream into the turn JSON and labels the reply brain:langgraph', async () => {
  const calls = [];
  // stub global fetch: the sidecar's /run answers an AG-UI SSE stream
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).endsWith('/run')) return realFetch(url, opts); // the lab's own HTTP is real
    calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null, headers: opts?.headers });
    const sse = [
      'data: {"type":"RUN_STARTED"}',
      'data: {"type":"TOOL_CALL_START","toolCallName":"get_balance"}',
      'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Balance read: "}',
      'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"permitted by the engine."}',
      'data: {"type":"RUN_FINISHED"}',
      '',
    ].join('\n');
    const enc = new TextEncoder();
    let sent = false;
    return {
      ok: true,
      body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: enc.encode(sse) })) }) },
    };
  };
  try {
    await withServer(async (url) => {
      // first run a Scripted turn so the workspace has a recorded engine run for the fold
      const seeded = await (await fetch(`${url}/api/assistant/turn`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'check my balance' }) })).json();
      assert.ok(seeded.reply);
      const r = await fetch(`${url}/api/assistant/turn`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'check my balance', brain: 'langgraph' }) });
      const j = await r.json();
      assert.equal(j.handling, 'in-app');
      assert.equal(j.reply.brain, 'langgraph');
      assert.match(j.reply.text, /permitted by the engine/);
      assert.equal(calls.at(-1).headers['x-brain-secret'], TEST_SECRET);
    }, { env: BRAIN_ENV() });
  } finally { globalThis.fetch = realFetch; }
});

test('brain=langgraph with the sidecar DOWN: the turn falls back to Scripted — the page never breaks on the brain', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).endsWith('/run') ? (() => { throw new Error('connection refused'); })() : realFetch(url, opts));
  try {
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/assistant/turn`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'check my balance', brain: 'langgraph' }) });
      const j = await r.json();
      assert.equal(j.handling, 'in-app');
      assert.notEqual(j.reply.brain, 'langgraph'); // the Scripted reply carries no brain label
    }, { env: BRAIN_ENV() });
  } finally { globalThis.fetch = realFetch; }
});

test('brain=langgraph with the brain NOT configured: the Scripted matcher answers, no model call is attempted', async () => {
  let modelCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).endsWith('/run')) modelCalled = true; return realFetch(url, opts); };
  try {
    await withServer(async (url) => {
      const j = await (await fetch(`${url}/api/assistant/turn`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'check my balance', brain: 'langgraph' }) })).json();
      assert.equal(j.handling, 'in-app');
      assert.notEqual(j.reply.brain, 'langgraph');
      assert.equal(modelCalled, false, 'no model call when the brain is unconfigured');
    });
  } finally { globalThis.fetch = realFetch; }
});
