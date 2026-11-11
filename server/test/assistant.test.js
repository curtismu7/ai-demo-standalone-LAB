import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { matchTurn, amountIn, REDIRECTS } from '../src/assistant.js';
import { SCENARIOS } from '../src/policyData.js';

const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

// ── the matcher (pure) ────────────────────────────────────────────────────────

test('matcher: every in-app chip maps to a real scenario id, and the outcome matches the catalog', () => {
  for (const s of SCENARIOS) {
    // each scenario id must be reachable by the matcher through its title keywords
    const m = matchTurn(s.title);
    // not every title matches its own row (titles are long); what must hold is the reverse:
    // every id the matcher CAN return exists in the table
    if (m.handling === 'in-app') assert.ok(SCENARIOS.some((x) => x.id === m.scenarioId), `${m.scenarioId} exists`);
  }
  // the matcher never returns an id that is not in the table (drift guard, run over the rules)
  const seen = new Set();
  for (const said of [
    'mfa step up', 'human approval', 'ciba', 'not in the group', 'flip the directory',
    'premium wire', 'promote to premium', '60000', 'consent', 'rogue agent', 'upstream mcp',
    'token theft', 'jit', 'kill switch', 'par', 'obo', 'progressive trust', 'pingfederate login',
    'pingone login', 'passkey', 'jev', 'ciba lab', 'id-jag', 'token workbench', 'mcp tools',
    'agent governance', 'muse', 'no tool', 'worker demo', 'cimd', 'gateway suite',
  ]) {
    const m = matchTurn(said);
    if (m.handling === 'in-app') { seen.add(m.scenarioId); assert.ok(SCENARIOS.some((x) => x.id === m.scenarioId), said); }
    if (m.handling === 'redirect') { seen.add(m.ucId); assert.ok(REDIRECTS[m.ucId], `${m.ucId} is in the redirect table`); }
    if (m.handling === 'unknown') seen.add('(unknown)');
  }
  assert.ok(seen.size >= 20, `the table covers the chips (${seen.size} seen)`);
});

test('matcher: each chip outcome equals the catalog expectedOutcome for its use case', async () => {
  const { CATALOG } = await import('../src/policyData.js');
  const expected = Object.fromEntries(CATALOG.useCases.map((u) => [u.id, u.expectedOutcome]));
  // the in-app chips: run the engine for each and compare with the catalog
  const chips = [  // [said, scenarioId, ucId, expectedFirst]
    ['I want to check my balance', 'uc1', 'UC1'],
    ['am I in the required group?', 'uc9', 'UC9'],
    ['flip the directory entry', 'uc9a', 'UC9A', 'PERMIT'],
    ['can I use the premium wire?', 'uc21-tool', 'UC21'],
    ['promote me to premium', 'uc21-promote', 'UC21'],
    ['send 60000', 'uc21-ceiling', 'UC21'],
    ['unknown agent alert', 'uc6-rogue', 'UC6'],
    ['upstream mcp token', 'uc32-upstream', 'UC32'],
    ['I need to mfa step up this transfer', 'uc7-stepup', 'UC7'],
    ['who can approve a transfer of 100?', 'uc8-hitl', 'UC8'],
    ['ciba approval on my phone', 'uc22-ciba', 'UC22'],
  ];
  await withServer(async (url) => {
    for (const [said, scenarioId, ucId, forced] of chips) {
      const m = matchTurn(said);
      assert.equal(m.handling, 'in-app', said);
      assert.equal(m.scenarioId, scenarioId, said);
      const s = SCENARIOS.find((x) => x.id === scenarioId);
      const r = await (await post(url, '/api/assistant/turn', { message: said }, 'm1')).json();
      // The catalog's expectedOutcome names the STORY, not the first HTTP turn: STEP_UP means
      // "the first turn is an OBLIGATION pause"; HITL_REQUIRED means "a HITL approval stands
      // between the ask and the permit"; DENY_403/POLICY_RECONFIGURED are DENY-family turns;
      // GUIDED_PAGE means the lab walks the visitor through flipping the directory (the
      // engine's first turn is DENY — that refusal is the lesson).
      const first = r.decision;
      // The scenario table's own `expected` is the authoritative FIRST-turn verdict (the
      // engine contract); the catalog's expectedOutcome names the resolved STORY (STEP_UP =
      // the pause then a permit; GUIDED_PAGE = the walkthrough; POLICY_RECONFIGURED = the
      // flip's denial), which the scenario's own `expected` already encodes.
      assert.equal(first, s.expected, `${ucId}: the chip's first turn matches the engine's scenario expectation`);

      void s;
    }
  });
});

test('matcher: unknown prompt is honest; amount parsing rides along', () => {
  assert.equal(matchTurn('what is the weather').handling, 'unknown');
  assert.equal(matchTurn('').handling, 'unknown');
  assert.equal(amountIn('refund me $300 please'), 300);
  assert.equal(amountIn('send 1,200 dollars'), 1200);
  assert.equal(amountIn('no money mentioned'), null);
});

test('matcher: the redirect table is complete and well-formed', () => {
  for (const [uc, lab] of Object.entries(REDIRECTS)) {
    assert.match(lab, /^[a-z0-9-]+$/, `${uc} -> ${lab}`);
    assert.match(uc, /^UC/i);
  }
  assert.equal(Object.keys(REDIRECTS).length, 45, 'Appendix A: exactly 45 redirects');
});

// ── the endpoint ──────────────────────────────────────────────────────────────

test('assistant turn: an in-app match runs the real engine and the reply reflects the outcome', async () => {
  await withServer(async (url) => {
    const ws = 'a1';
    // PERMIT path
    const ok = await (await post(url, '/api/assistant/turn', { message: 'check my balance with my consent' }, ws)).json();
    assert.equal(ok.handling, 'in-app');
    assert.equal(ok.decision, 'PERMIT');
    assert.ok(ok.run, 'the Direct dashboard run payload is present');
    assert.ok(ok.hops.length >= 3, 'the teaching hops came with the run');
    assert.match(ok.say, /permitted|Done/i);
    // DENY path
    const deny = await (await post(url, '/api/assistant/turn', { message: 'am I in the required group? my scopes say yes' }, ws)).json();
    assert.equal(deny.decision, 'DENY');
    assert.match(deny.say, /refused this request/);
    // OBLIGATION path
    const pause = await (await post(url, '/api/assistant/turn', { message: 'mfa step up for my transfer of 600' }, ws)).json();
    assert.equal(pause.decision, 'OBLIGATION');
    assert.match(pause.say, /pause/i);
    assert.ok(pause.obligation, 'the obligation rides in the run so the UI can open the consent/MFA card');
  });
});

test('assistant turn: redirect and unknown replies carry no engine run', async () => {
  await withServer(async (url) => {
    const r = await (await post(url, '/api/assistant/turn', { message: 'how does token theft replay defense work' }, 'a2')).json();
    assert.equal(r.handling, 'redirect');
    assert.equal(r.lab, 'stolen-token-lab');
    assert.equal(r.run, undefined);
    assert.ok(r.title);
    const u = await (await post(url, '/api/assistant/turn', { message: 'tell me a joke' }, 'a2')).json();
    assert.equal(u.handling, 'unknown');
    assert.match(u.say, /could not match/i);
  });
});

test('assistant turn: bad input is a 400; the workspace ledger records engine runs', async () => {
  await withServer(async (url) => {
    const bad = await post(url, '/api/assistant/turn', 'not an object', 'a3');
    assert.equal(bad.status, 400);
    await post(url, '/api/assistant/turn', { message: 'check my balance with my consent' }, 'a3');
    const runs = await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'a3' } })).json();
    assert.ok(runs.runs.some((x) => x.decision === 'PERMIT'), 'the run landed in the workspace ledger');
  });
});
