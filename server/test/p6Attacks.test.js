// P6 batch 2 (attacks): UC5, UC10, UC11, UC13, UC16b, UC29 run in-app. Each new scenario
// runs through the REAL engine path (consent -> /api/assistant/turn, seeded by the SHARED
// scenario.js rule the endpoint and the doctor both apply) and its computed first-turn
// outcome must match the catalog's expectedOutcome DENY family for its ucId — the catalog
// is the spec. Also: the launcher derives the "Runs here" rows from SCENARIOS, so these
// six appear there automatically, and the engine mechanisms the batch relies on are
// unit-checked directly (the mutation target).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { SCENARIOS, CATALOG } from '../src/policyData.js';
import { usecaseRows } from '../src/usecases.js';
import { decide, decideWithObligation, exchange, validateCustody, TOOL_REQUIRED_SCOPE } from '../src/pdp.js';
import { seedFor, tokenFor } from '../src/scenario.js';

const BATCH = [
  ['UC5', 'uc5-scope', 'DENY_403', 'insufficient_scope'],
  ['UC10', 'uc10-takeover', 'DENY', 'resource_owner_mismatch'],
  ['UC11', 'uc11-badclient', 'DENY_401', 'bad_audience'],
  ['UC13', 'uc13-deputy', 'DENY', 'unauthorized_actor'],
  ['UC16b', 'uc16b-forward', 'DENY_403', 'user_token_forwarding_disabled'],
  ['UC29', 'uc29-outage', 'DENY_503', 'validation_unavailable'],
];
const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

const expectedOf = (ucId) => CATALOG.useCases.find((u) => u.id === ucId)?.expectedOutcome ?? null;

test('P6 batch 2: every new scenario id exists, is the attacks track, and the catalog specs the expectedOutcome', () => {
  for (const [ucId, scId, catalogOutcome, code] of BATCH) {
    const sc = SCENARIOS.find((s) => s.id === scId);
    assert.ok(sc, `${ucId}: a scenario is wired`);
    assert.equal(sc.ucId, ucId, `${scId}: attributed to ${ucId}`);
    assert.equal(sc.track, 'attacks', `${ucId}: track is attacks`);
    assert.equal(expectedOf(ucId), catalogOutcome, `${ucId}: the catalog expects ${catalogOutcome}`);
    sc.code = code; // stashed for the engine assertion below
  }
});

test('P6 batch 2: each scenario runs the engine in-app and the refusal code is the catalog story', async () => {
  await withServer(async (url) => {
    for (const [ucId, scId, catalogOutcome, code] of BATCH) {
      const sc = SCENARIOS.find((s) => s.id === scId);
      const r = await (await post(url, '/api/assistant/turn', { message: sc.title }, `p6b-${ucId.toLowerCase()}`)).json();
      assert.equal(r.handling, 'in-app', `${ucId}: the turn ran in-app`);
      assert.equal(r.ucId, ucId, `${ucId}: the run attributes the use case`);
      assert.equal(r.scenarioId, scId, `${ucId}: the right scenario matched`);
      // the catalog's expectedOutcome is the HTTP story (DENY_403 / DENY_401 / DENY_503);
      // the engine's verdict is DENY with the stage code the story names
      assert.equal(r.decision, 'DENY', `${ucId}: computed ${r.decision} vs catalog ${expectedOf(ucId)}`);
      assert.equal(r.run.code, code, `${ucId}: the refusal code`);
      assert.ok(r.run.demoHops?.length === 10, `${ucId}: the evidence adapter emitted the 10 chain hops`);
      assert.ok(r.run.tokens10?.length === 3, `${ucId}: the run carries the token cards`);
    }
  });
});

test('P6 batch 2: the launcher derives Runs-here for all six (in-app is derived from SCENARIOS, not hardcoded)', () => {
  const rows = usecaseRows(CATALOG);
  for (const [ucId] of BATCH) {
    const row = rows.find((r) => r.id === ucId);
    assert.ok(row, `${ucId}: a launcher row exists`);
    assert.equal(row.runsHere, true, `${ucId}: Runs here`);
    assert.equal(row.route, 'Here + go deeper', `${ucId}: in-app route`);
  }
});

// ── the mechanisms the batch relies on, unit-checked (the mutation targets) ──

test('UC5 mechanism: a token whose scope does not cover the tool requirement is refused at the gateway', () => {
  // read-scoped token, write tool
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  const d = decide({ token: t, groups: ['privileged'], tool: 'create_wire_transfer' });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.stage, 'gateway');
  assert.equal(d.code, 'insufficient_scope');
  // the required-scope table is what makes the check truthful
  assert.equal(TOOL_REQUIRED_SCOPE.create_wire_transfer, 'transfers:write');
  // a properly scoped token sails through to the policy
  const ok = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'transfers:write' });
  const d2 = decide({ token: ok, groups: ['privileged'], tool: 'create_wire_transfer' });
  assert.notEqual(d2.code, 'insufficient_scope');
});

test('UC10 mechanism: the owner match binds the resource to the token subject', () => {
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  const d = decide({ token: t, groups: ['privileged'], tool: 'get_balance', resourceOwner: 'otherUser' });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.stage, 'policy');
  assert.equal(d.code, 'resource_owner_mismatch');
  // the SAME call naming the caller's own owner permits
  const d2 = decide({ token: t, groups: ['privileged'], tool: 'get_balance', resourceOwner: 'demoUser' });
  assert.equal(d2.decision, 'PERMIT');
  // no resourceOwner argument: the check does not fire (the other scenarios are untouched)
  assert.equal(decide({ token: t, groups: ['privileged'], tool: 'get_balance' }).decision, 'PERMIT');
});

test('UC16b mechanism: a raw forwarded user token is refused at custody, before the gateway', () => {
  const raw = { sub: 'demoUser', aud: 'ai-demo-standalone', scope: 'openid accounts:read', rawUserToken: true };
  const d = decide({ token: raw, groups: ['privileged'], tool: 'get_balance' });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.stage, 'gateway');
  assert.equal(d.code, 'user_token_forwarding_disabled');
  assert.equal(validateCustody(raw).code, 'user_token_forwarding_disabled');
  // the same token WITH an act claim is an exchanged delegated token: custody passes
  assert.equal(validateCustody({ ...raw, act: { sub: 'demo-agent' } }).valid, true);
  // an ordinary delegated token is untouched
  assert.equal(validateCustody(exchange({ userSub: 'demoUser', actorClientId: 'demo-agent' })).valid, true);
});

test('UC29 mechanism: a validation outage denies before anything else can run (fail closed)', () => {
  const t = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  const d = decideWithObligation({ token: { ...t, validationDown: true }, groups: ['privileged'], tier: 'Standard', tool: 'get_balance', amount: null });
  assert.equal(d.verdict.decision, 'DENY');
  assert.equal(d.verdict.code, 'validation_unavailable');
  assert.equal(d.verdict.stage, 'gateway');
  // fail closed holds even for a call that would otherwise be permitted
  assert.equal(d.obligation, null);
});

test('P6 batch 2: the shared seeding rule seeds every attack scenario the way the endpoint does', () => {
  // UC5: wrong scope minted on the token
  const uc5 = SCENARIOS.find((s) => s.id === 'uc5-scope');
  assert.equal(tokenFor(uc5).scope, 'accounts:read');
  assert.equal(TOOL_REQUIRED_SCOPE[uc5.tool], 'transfers:write');
  // UC10: the scenario names the other owner
  const uc10 = SCENARIOS.find((s) => s.id === 'uc10-takeover');
  assert.equal(uc10.resourceOwner, 'otherUser');
  assert.equal(uc10.resourceOwner !== uc10.user, true);
  // UC13: an unregistered actor
  const uc13 = SCENARIOS.find((s) => s.id === 'uc13-deputy');
  assert.equal(uc13.actor, 'rogue-agent');
  // UC16b: the raw-user-token marker
  const uc16b = SCENARIOS.find((s) => s.id === 'uc16b-forward');
  assert.equal(tokenFor(uc16b).rawUserToken, true);
  assert.equal(seedFor(uc16b).groups.includes('privileged'), true, 'the takeover story is not the group gate: groups are fine');
  // UC29: the outage marker
  const uc29 = SCENARIOS.find((s) => s.id === 'uc29-outage');
  assert.equal(tokenFor(uc29).validationDown, true);
  // UC11: a foreign audience
  const uc11 = SCENARIOS.find((s) => s.id === 'uc11-badclient');
  assert.equal(tokenFor(uc11).aud, 'weather-api.example');
});
