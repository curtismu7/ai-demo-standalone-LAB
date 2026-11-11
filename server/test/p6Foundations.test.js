// P6 batch 1 (foundations): UC3, UC19, UC20, UC33, UC34, UC35 run in-app. Each new scenario
// runs through the REAL engine path (consent -> /api/assistant/turn, seeded exactly the way
// the scenario states) and its computed first-turn outcome must EQUAL the catalog's
// expectedOutcome for that ucId — the catalog is the spec. Also: the launcher derives the
// "Runs here" rows from SCENARIOS, so these six appear there automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { SCENARIOS } from '../src/policyData.js';
import { CATALOG } from '../src/story.js';
import { usecaseRows } from '../src/usecases.js';

const P6 = ['UC3', 'UC19', 'UC20', 'UC33', 'UC34', 'UC35'];
const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

const expectedOf = (ucId) => CATALOG.useCases.find((u) => u.id === ucId)?.expectedOutcome ?? null;

test('P6 batch 1: every new scenario id exists and the catalog specs an expectedOutcome for its ucId', () => {
  for (const ucId of P6) {
    const sc = SCENARIOS.find((s) => s.ucId === ucId);
    assert.ok(sc, `${ucId}: a scenario is wired`);
    assert.equal(sc.track, 'foundations', `${ucId}: track is foundations`);
    assert.equal(expectedOf(ucId), 'PERMIT', `${ucId}: the catalog expects PERMIT (the spec this test asserts)`);
  }
});

test('P6 batch 1: each scenario runs the engine and the first-turn outcome equals the catalog expectedOutcome', async () => {
  await withServer(async (url) => {
    for (const ucId of P6) {
      const sc = SCENARIOS.find((s) => s.ucId === ucId);
      const r = await (await post(url, '/api/assistant/turn', { message: sc.title }, `p6-${ucId.toLowerCase()}`)).json();
      assert.equal(r.handling, 'in-app', `${ucId}: the turn ran in-app`);
      assert.equal(r.ucId, ucId, `${ucId}: the run attributes the use case`);
      assert.equal(r.scenarioId, sc.id, `${ucId}: the right scenario matched`);
      assert.equal(r.decision, expectedOf(ucId), `${ucId}: computed ${r.decision} vs catalog ${expectedOf(ucId)}`);
      assert.equal(r.run.tool, sc.tool, `${ucId}: the scenario's tool rode along`);
      assert.ok(r.run.demoHops?.length === 10, `${ucId}: the evidence adapter emitted the 10 chain hops`);
      assert.ok(r.run.tokens10?.length === 3, `${ucId}: the run carries the token cards`);
    }
  });
});

test('P6 batch 1: UC33 reaches the engine with show_mortgage, and the tool is in the story TOOLS', async () => {
  const { rawStory } = await import('../src/story.js');
  assert.ok(rawStory().tools.some((t) => t.name === 'show_mortgage'), 'show_mortgage is a listed tool');
  const sc = SCENARIOS.find((s) => s.ucId === 'UC33');
  assert.equal(sc.tool, 'show_mortgage');
  assert.equal(sc.user, 'demoUser');
  await withServer(async (url) => {
    const consent = await (await post(url, '/api/consent', { user: 'demoUser', actor: 'demo-agent' }, 'p6-tool')).json();
    assert.equal(consent.token.act.sub, 'demo-agent');
    const r = await (await post(url, '/api/authorize', { token: consent.token, tool: 'show_mortgage' }, 'p6-tool')).json();
    assert.equal(r.decision, 'PERMIT', 'the mortgage lookup permits under the same delegated token');
  });
});

test('P6 batch 1: the launcher derives Runs-here for all six (in-app is derived from SCENARIOS, not hardcoded)', () => {
  const rows = usecaseRows(CATALOG);
  for (const ucId of P6) {
    const row = rows.find((r) => r.id === ucId);
    assert.ok(row, `${ucId}: a launcher row exists`);
    assert.equal(row.runsHere, true, `${ucId}: Runs here`);
    assert.equal(row.route, 'Here + go deeper', `${ucId}: in-app route`);
  }
});
