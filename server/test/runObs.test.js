// Rule 27: the lab's half of the run-observability panel (runObs.js, the run field on recorded actions and GET /api/runs/record).
// The vendored collector has its own tests in the shared folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunObservability, classify, layerMatchers } from '../src/runObservability.js';
import { KEEP_RUNS, SERVICE, createRunLog, decisionLine, lineValue, actionEvents, recordOf } from '../src/runObs.js';
import { createApp } from '../src/app.js';
import { createWorkspaces } from '../src/workspaces.js';

const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient|not allowed/i;
const LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ai-demo-standalone-lab decision step=[A-Za-z0-9._:/@-]+ layer=[a-z]+ actor=[A-Za-z0-9._:/@-]+ result=(?:passed|stopped|unclear) run=[A-Za-z0-9._:/@-]+$/;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];
// No shared matcher reads a line, in any of the shapes a collector could hand it (the whole line: no field is cut out first).
const noMatcherReads = (line) => {
  const at = line.split(' ')[0];
  for (const product of PRODUCTS) {
    for (const message of [line, `[${at}] INFO: ${line.split(' ').slice(1).join(' ')}`, `[${at}] WARN: ${line.split(' ').slice(1).join(' ')}`]) {
      assert.equal(classify({ product, message, at: Date.parse(at), atExact: at }, []), null, `${product}: ${message}`);
    }
  }
};

const TOK = { sub: 'demoUser', act: { sub: 'demo-agent' }, scope: 'accounts:read transfers:write' };

test('a PERMIT authorize is an allowed Authorize row with the policy node; the chain carries user, agent and scopes', async () => {
  const events = actionEvents({ tool: 'get_balance', decision: 'PERMIT', reason: 'allowed by policy', token: TOK, ucId: 'UC1' }, { user: 'demoUser', agent: 'demo-agent' });
  assert.equal(events.length, 1);
  const [ev] = events;
  assert.equal(ev.layer, 'authorize');
  assert.equal(ev.outcome, 'allowed');
  assert.equal(ev.detail.policy.decision, 'permit');
  assert.equal(ev.detail.policy.id, 'UC1');
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'run-abc123-1', source: 'mock', startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.deepEqual(assertRunObservability(rec), []);
  const c = rec.chain.chains[0];
  assert.equal(c.user.value, 'demoUser');
  assert.equal(c.agent.value, 'demo-agent');
  assert.deepEqual(c.scopes.values, ['accounts:read', 'transfers:write']);
  assert.equal(c.policies.length, 1);
  assert.equal(c.policies[0].decision, 'permit');
});

test('a DENY is a refused Authorize row; a mint is an allowed Privilege row with no policy node; an NHI step is agent information', async () => {
  const deny = actionEvents({ tool: 'transfer', decision: 'DENY', reason: 'not allowed for this tier', token: TOK })[0];
  assert.equal(deny.layer, 'authorize');
  assert.equal(deny.outcome, 'refused');
  assert.equal(deny.detail.policy.decision, 'deny');
  const mint = actionEvents({ tool: 'consent', decision: 'MINTED', reason: 'minted', token: TOK })[0];
  assert.equal(mint.layer, 'privilege');
  assert.equal(mint.outcome, 'allowed');
  assert.equal(mint.detail.policy, undefined, 'a mint is not a policy decision');
  const leaver = actionEvents({ tool: 'nhi-revoke', decision: 'LEAVER', reason: 'revoked', token: null })[0];
  assert.equal(leaver.layer, 'agent');
  assert.equal(leaver.outcome, 'info');
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'run-abc123-2', source: 'mock', startedAt: at, endedAt: at, events: [leaver].map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.deepEqual(assertRunObservability(rec), []);
  assert.equal(rec.chain, null, 'a lifecycle step carries no chain keys');
});

test('an unknown decision word is information, not a crash; every line survives the sanitiser and no matcher reads one', () => {
  const ev = actionEvents({ tool: 'future.op', decision: 'SOMETHING_NEW', reason: 'a later version', token: null })[0];
  assert.equal(ev.layer, 'authorize');
  assert.equal(ev.outcome, 'info');
  const line = decisionLine({ ...ev, at: '2026-11-24T10:00:00.000Z', who: 'demoUser x=1\ninjected' }, 'run\nx=1');
  assert.equal(line.split('\n').length, 1);
  assert.match(line, LINE);
  noMatcherReads(line);
});

test('the log keeps the last few runs and Reset clears it', () => {
  const { runLog } = capture();
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) runLog.mock(() => actionEvents({ tool: 'op', decision: 'PERMIT', reason: 'x', token: null }));
  assert.equal(runLog.size(), KEEP_RUNS);
  assert.ok(runLog.get('run-nope-1') === null);
});
function capture() {
  const lines = [];
  return { lines, runLog: createRunLog({ write: (l) => lines.push(l), clock: () => Date.parse('2026-11-24T10:00:00.000Z') }) };
}

test('over the API: an assistant turn answers its run id and the record route answers that record', async () => {
  const { runLog } = capture();
  const { createServer } = await import('node:http');
  const server = createServer(createApp({ workspaceAuth: false, runLog, workspaces: createWorkspaces() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = async (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const turn = await post('/api/assistant/turn', { message: 'Check my balance' });
    assert.equal(turn.status, 200);
    assert.ok(turn.body.obs?.id, 'a run id answers a recorded action');
    const rec = await fetch(`${base}/api/runs/record?runId=${encodeURIComponent(turn.body.obs.id)}`).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(rec.status, 200);
    assert.deepEqual(assertRunObservability(rec.body.record), []);
    const stamped = rec.body.record.rows.filter((r) => r.origin !== 'not-logged');
    assert.equal(stamped.length, 1, 'one decision row for one action');
    assert.equal(stamped[0].outcome, 'allowed', 'a balance read is permitted for the seeded directory');
    assert.equal((await fetch(`${base}/api/runs/record?runId=nope`)).status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});

test('Reset clears the observability runs: the record route no longer answers a run that Reset cleared', async () => {
  const { runLog } = capture();
  const { createServer } = await import('node:http');
  const server = createServer(createApp({ workspaceAuth: false, runLog, workspaces: createWorkspaces() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = async (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const turn = await post('/api/assistant/turn', { message: 'Check my balance' });
    const id = turn.body.obs.id;
    assert.equal((await fetch(`${base}/api/runs/record?runId=${encodeURIComponent(id)}`)).status, 200, 'the run is kept before Reset');
    assert.equal((await post('/api/reset', {})).status, 200);
    const after = await fetch(`${base}/api/runs/record?runId=${encodeURIComponent(id)}`).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(after.status, 200);
    assert.equal(after.body.record, null, 'Reset cleared the run, so no record is kept for it');
    assert.match(after.body.message, /no longer kept/, 'the answer says the run is no longer kept');
  } finally { await new Promise((r) => server.close(r)); }
});

test('Reset clears only its own workspace: another workspace keeps its observability run', async () => {
  const { runLog } = capture();
  const { createServer } = await import('node:http');
  const server = createServer(createApp({ workspaceAuth: false, runLog, workspaces: createWorkspaces() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = async (p, body, ws) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-workspace': ws }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const record = async (id, ws) => fetch(`${base}/api/runs/record?runId=${encodeURIComponent(id)}`, { headers: { 'x-workspace': ws } }).then(async (r) => (await r.json()).record);
    const a = await post('/api/assistant/turn', { message: 'Check my balance' }, 'wsa');
    const b = await post('/api/assistant/turn', { message: 'Check my balance' }, 'wsb');
    assert.equal((await post('/api/reset', {}, 'wsa')).status, 200);
    assert.equal(await record(a.body.obs.id, 'wsa'), null, 'wsa lost its run to its own Reset');
    assert.notEqual(await record(b.body.obs.id, 'wsb'), null, 'wsb keeps its run when wsa is reset');
  } finally { await new Promise((r) => server.close(r)); }
});

test('one workspace cannot evict another workspace\'s runs: the cap is per workspace', () => {
  const { runLog } = capture();
  const build = () => actionEvents({ tool: 'op', decision: 'PERMIT', reason: 'x', token: null });
  const theirs = runLog.mock(build, 'wsb');
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) runLog.mock(build, 'wsa');
  assert.ok(runLog.get(theirs, 'wsb'), 'wsb\'s run is still kept after wsa recorded more than KEEP_RUNS runs');
  assert.equal(runLog.size(), KEEP_RUNS + 1, 'wsa keeps KEEP_RUNS runs and wsb keeps its one');
});

test('the record route answers another workspace\'s run exactly as a run no longer kept', async () => {
  const { runLog } = capture();
  const { createServer } = await import('node:http');
  const server = createServer(createApp({ workspaceAuth: false, runLog, workspaces: createWorkspaces() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = (runId, ws) => fetch(`${base}/api/runs/record?runId=${encodeURIComponent(runId)}`, { headers: { 'x-workspace': ws } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const turn = await fetch(`${base}/api/assistant/turn`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-workspace': 'wsa' }, body: JSON.stringify({ message: 'Check my balance' }) }).then((r) => r.json());
    const id = turn.obs.id;
    const own = await ask(id, 'wsa');
    assert.equal(own.status, 200);
    assert.ok(own.body.record, 'the owning workspace reads its own run');
    const other = await ask(id, 'wsb');
    const missing = await ask('run-000000-999', 'wsb');
    assert.equal(other.body.record, null, 'wsb does not read wsa\'s run');
    assert.equal(other.status, missing.status, 'the same status as a run that is not kept');
    assert.deepEqual(other.body, missing.body, 'the same answer as a run that is not kept');
  } finally { await new Promise((r) => server.close(r)); }
});
