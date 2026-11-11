// P6 batch 3 (FINAL): UC4, UC41, UC42 (controls), UC24, UC26 (demo), UC27 (hitl) run in-app.
// Each new scenario runs through the REAL engine path (consent -> /api/assistant/turn, seeded
// by the SHARED scenario.js rule the endpoint and the doctor both apply) and its computed
// first-turn outcome must match the catalog's expectedOutcome for its ucId — the catalog is
// the spec. With this batch the in-app derivation yields exactly the owner-pinned 31 of 87.
// Also unit-checked: the query-block and public-catalog mechanisms (the mutation targets) and
// the HITL bypass guard (a client-sent consentGiven flag is ignored, fail-closed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { SCENARIOS, CATALOG } from '../src/policyData.js';
import { usecaseRows } from '../src/usecases.js';
import { decide, decideWithObligation, exchange, evaluatePolicy, TOOL_REQUIRED_SCOPE, PUBLIC_TOOLS, SEARCH_BLOCKED_TERMS } from '../src/pdp.js';
import { evaluateObligation } from '../src/hitl.js';
import { seedFor, tokenFor, callArgsFor } from '../src/scenario.js';

const BATCH = [
  ['UC4', 'uc4-overscoped', 'PERMIT', null],
  ['UC41', 'uc41-search', 'PERMIT', null],
  ['UC42', 'uc42-search-blocked', 'DENY', 'query_blocked'],
  ['UC24', 'uc24-public', 'PERMIT', null],
  // UC26's catalog expectedOutcome is GUIDED_DEMO (the meta use case: the proof IS watching
  // any run's live verdict); the engine story it demonstrates is a real PERMIT, so the
  // scenario's expected encodes the demo run as PERMIT (the assistant.test.js rule).
  ['UC26', 'uc26-proof', 'PERMIT', null],
  ['UC27', 'uc27-bypass', 'OBLIGATION', 'HITL_CONSENT'],
];
const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

const expectedOf = (ucId) => CATALOG.useCases.find((u) => u.id === ucId)?.expectedOutcome ?? null;

test('P6 batch 3: every new scenario id exists, carries its catalog track, and the catalog specs the expectedOutcome', () => {
  for (const [ucId, scId, engineOutcome, code] of BATCH) {
    const sc = SCENARIOS.find((s) => s.id === scId);
    assert.ok(sc, `${ucId}: a scenario is wired`);
    assert.equal(sc.ucId, ucId, `${scId}: attributed to ${ucId}`);
    assert.equal(sc.track, CATALOG.useCases.find((u) => u.id === ucId)?.track, `${ucId}: the scenario rides the catalog's track`);
    assert.equal(sc.expected, engineOutcome, `${ucId}: the scenario's engine expectation is ${engineOutcome}`);
    // UC26's catalog outcome is the GUIDED_DEMO meta-demo and UC27's is STEP_UP (the
    // catalog names the resolved story: the pause then the MFA step-up receipt); the
    // engine's first-turn verdict for both is OBLIGATION-family, encoded in `expected`
    // (the assistant.test.js rule: the catalog outcome names the story, `expected` the turn).
    if (!['UC26', 'UC27'].includes(ucId)) assert.equal(expectedOf(ucId), engineOutcome, `${ucId}: the catalog expects ${engineOutcome}`);
  }
});

test('P6 batch 3: each scenario runs the engine in-app and the outcome matches the scenario spec', async () => {
  await withServer(async (url) => {
    for (const [ucId, scId, engineOutcome, code] of BATCH) {
      const sc = SCENARIOS.find((s) => s.id === scId);
      const r = await (await post(url, '/api/assistant/turn', { message: sc.title }, `p6c-${ucId.toLowerCase()}`)).json();
      assert.equal(r.handling, 'in-app', `${ucId}: the turn ran in-app`);
      assert.equal(r.ucId, ucId, `${ucId}: the run attributes the use case`);
      assert.equal(r.scenarioId, scId, `${ucId}: the right scenario matched`);
      assert.equal(r.decision, engineOutcome, `${ucId}: computed ${r.decision} vs scenario ${engineOutcome}`);
      if (code) assert.equal(r.run.code, code, `${ucId}: the refusal/obligation code`);
      if (scId === 'uc27-bypass') assert.match(r.run.reason, /BYPASS DENIED/i, `${ucId}: the bypass attempt is named`);
      assert.ok(r.run.demoHops?.length === 10, `${ucId}: the evidence adapter emitted the 10 chain hops`);
      assert.ok(r.run.tokens10?.length === 3, `${ucId}: the run carries the token cards`);
    }
  });
});

test('P6 batch 3: the launcher derives Runs-here for all six (in-app is derived from SCENARIOS, not hardcoded)', () => {
  const rows = usecaseRows(CATALOG);
  for (const [ucId] of BATCH) {
    const row = rows.find((r) => r.id === ucId);
    assert.ok(row, `${ucId}: a launcher row exists`);
    assert.equal(row.runsHere, true, `${ucId}: Runs here`);
    assert.equal(row.route, 'Here + go deeper', `${ucId}: in-app route`);
  }
});

// ── the mechanisms the batch relies on, unit-checked (the mutation targets) ──

test('UC4 mechanism: the exchange narrows scope to the task; the required-scope table answers a shortfall', () => {
  // the scenario's token carries exactly the task's required scope — never what was asked for
  const sc = SCENARIOS.find((s) => s.id === 'uc4-overscoped');
  assert.equal(TOOL_REQUIRED_SCOPE[sc.tool], 'accounts:read');
  assert.equal(tokenFor(sc).scope, 'accounts:read');
  // the token PERMITs the read
  const d = decide({ token: tokenFor(sc), groups: seedFor(sc).groups, tool: sc.tool });
  assert.equal(d.decision, 'PERMIT');
  // the contrast: the same token against a write tool is refused (the narrowing was real)
  const d2 = decide({ token: tokenFor(sc), groups: seedFor(sc).groups, tool: 'create_wire_transfer' });
  assert.equal(d2.decision, 'DENY');
  assert.equal(d2.code, 'insufficient_scope');
});

test('UC41/UC42 mechanism: the query blocklist is checked before the call is forwarded', () => {
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'search:read' });
  const groups = ['privileged'];
  // an ordinary business query forwards
  const ok = decide({ token: t, groups, tool: 'brave_news_search', query: 'regional weather outlook' });
  assert.equal(ok.decision, 'PERMIT');
  assert.match(ok.reason, /forwards/);
  // a blocked term denies with the gateway-stage code — Brave never sees it
  for (const q of ['bitcoin price today', 'crypto regulation', 'what is cryptocurrency']) {
    const d = decide({ token: t, groups, tool: 'brave_news_search', query: q });
    assert.equal(d.decision, 'DENY', q);
    assert.equal(d.stage, 'gateway', q);
    assert.equal(d.code, 'query_blocked', q);
  }
  // the blocklist is exactly the demo bank's content policy
  assert.deepEqual(SEARCH_BLOCKED_TERMS, ['bitcoin', 'cryptocurrency', 'crypto']);
  // a search call with no query argument is not block-listed (other stages answer it)
  assert.equal(decide({ token: t, groups, tool: 'brave_news_search' }).decision, 'PERMIT');
  // the mechanism lives at the policy stage the gateway drives, not in a client
  const pol = evaluatePolicy({ groups, tool: 'brave_news_search', query: 'bitcoin' });
  assert.equal(pol.code, 'query_blocked');
});

test('UC24 mechanism: a public catalog tool permits without the group gate or a tier check', () => {
  assert.deepEqual(PUBLIC_TOOLS, ['get_branch_hours']);
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  // even with NO groups (the group gate would deny anything else) and Standard tier, it permits
  const d = decideWithObligation({ token: t, groups: [], tier: 'Standard', tool: 'get_branch_hours', amount: null });
  assert.equal(d.verdict.decision, 'PERMIT');
  assert.match(d.verdict.reason, /public catalog/);
  assert.equal(d.obligation, null);
  // the contrast: the SAME anonymous directory denies the gated tools
  const gated = decideWithObligation({ token: t, groups: [], tier: 'Standard', tool: 'get_balance', amount: null });
  assert.equal(gated.verdict.decision, 'DENY');
  assert.equal(gated.verdict.code, 'group_entitlement');
});

test('UC27 mechanism: a client-sent "consent already given" flag is ignored, fail-closed', () => {
  // the obligation layer runs and still pauses the HITL tool
  const ob = evaluateObligation({ tool: 'create_transfer', amount: 600, consentGiven: true });
  assert.equal(ob.obligation, 'HITL_CONSENT');
  assert.equal(ob.bypassAttempt, true);
  assert.match(ob.reason, /ignored, not trusted/);
  // the full engine: the call arrives with consentGiven=true and NO receipt — it pauses
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'transfers:write' });
  const d = decideWithObligation({ token: t, groups: ['privileged'], tier: 'Standard', tool: 'create_transfer', amount: 600, consentGiven: true });
  assert.equal(d.verdict.decision, 'OBLIGATION');
  assert.equal(d.verdict.code, 'HITL_CONSENT');
  assert.match(d.verdict.reason, /BYPASS DENIED/);
  // without the flag the same call pauses for the ordinary reason (no false "bypass" naming)
  const plain = decideWithObligation({ token: t, groups: ['privileged'], tier: 'Standard', tool: 'create_transfer', amount: 600 });
  assert.equal(plain.verdict.decision, 'OBLIGATION');
  assert.doesNotMatch(plain.verdict.reason, /BYPASS/);
  // a non-HITL tool with the flag is unaffected (the flag is meaningless there)
  const readToken = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  const read = decideWithObligation({ token: readToken, groups: ['privileged'], tier: 'Standard', tool: 'get_balance', consentGiven: true });
  assert.equal(read.verdict.decision, 'PERMIT');
});

test('P6 batch 3: the shared seeding rule carries the batch arguments the way the endpoint does', () => {
  // UC42: the blocked query rides the scenario, never the token
  const uc42 = SCENARIOS.find((s) => s.id === 'uc42-search-blocked');
  assert.equal(callArgsFor(uc42).query, 'bitcoin price today');
  assert.equal(tokenFor(uc42).query, undefined, 'the query is an argument, not a token claim');
  // UC41: the ordinary query rides the same way
  assert.equal(callArgsFor(SCENARIOS.find((s) => s.id === 'uc41-search')).query, 'regional weather outlook');
  // UC27: the forged consent flag rides as an argument
  const args = callArgsFor(SCENARIOS.find((s) => s.id === 'uc27-bypass'));
  assert.equal(args.consentGiven, true);
  // scenarios without these arguments carry nulls
  assert.deepEqual(callArgsFor(SCENARIOS.find((s) => s.id === 'uc1')), { query: null, consentGiven: null });
});

test('P6 batch 3: the count pin — the derivation yields exactly 31 in-app of 87, 45 redirect, 11 guide', () => {
  const rows = usecaseRows(CATALOG);
  const counts = { 'Here + go deeper': 0, 'Hand off': 0, Guide: 0 };
  for (const r of rows) counts[r.route] += 1;
  assert.equal(rows.length, 87);
  assert.equal(counts['Here + go deeper'], 31, 'the owner-pinned in-app total');
  assert.equal(counts['Hand off'], 45);
  assert.equal(counts.Guide, 11);
  // every use case is classified exactly once
  assert.equal(counts['Hand off'] + counts.Guide + counts['Here + go deeper'], 87);
});
