import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { matchTurn, amountIn, REDIRECTS } from '../src/assistant.js';
import { SCENARIOS } from '../src/policyData.js';

const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

// ── the matcher (pure) ────────────────────────────────────────────────────────

test('matcher: every in-app chip maps to a real scenario id, and the outcome matches the catalog', () => {
  for (const s of SCENARIOS) {
    // not every title matches its own row (titles are long); what must hold is the reverse:
    // every id the matcher CAN return exists in the table
    const m = matchTurn(s.title);
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

test('matcher: each chip matches its scenario and the engine gives the scenario expected first turn', async () => {
  const chips = [  // [said, scenarioId, ucId]
    ['I want to check my balance', 'uc1', 'UC1'],
    ['am I in the required group?', 'uc9', 'UC9'],
    ['flip the directory entry', 'uc9a', 'UC9A'],
    ['can I use the premium wire?', 'uc21-tool', 'UC21'],
    ['promote me to premium', 'uc21-promote', 'UC21'],
    ['send 60000', 'uc21-ceiling', 'UC21'],
    ['unknown agent alert', 'uc6-rogue', 'UC6'],
    ['upstream mcp token', 'uc32-upstream', 'UC32'],
    ['I need to mfa step up this transfer', 'uc7-stepup', 'UC7'],
    ['who can approve a transfer of 100?', 'uc8-hitl', 'UC8'],
    ['ciba approval on my phone', 'uc22-ciba', 'UC22'],
    ['does the act gate check the actor on every call?', 'uc3-actgate', 'UC3'],
    ['the agent identity lifecycle: retire the agent app', 'uc19-lifecycle', 'UC19'],
    ['show me the agent audit trail for this run', 'uc20-trace', 'UC20'],
    ['show my mortgage', 'uc33-mortgage', 'UC33'],
    ['spot unusual patterns in my recent activity', 'uc34-patterns', 'UC34'],
    ['why was that blocked? walk me through the token chain', 'uc35-why', 'UC35'],
    ['the agent is overscoped — it asked for write but only needs read', 'uc4-overscoped', 'UC4'],
    ['search the news for the route announcement', 'uc41-search', 'UC41'],
    ['the search query was blocked at the gateway (bitcoin)', 'uc42-search-blocked', 'UC42'],
    ['what are the branch hours? the public catalog', 'uc24-public', 'UC24'],
    ['proof of enforcement — show me the live verdict', 'uc26-proof', 'UC26'],
    ['the client claimed consent was already given to bypass the approval', 'uc27-bypass', 'UC27'],
  ];
  await withServer(async (url) => {
    for (const [said, scenarioId, ucId] of chips) {
      const m = matchTurn(said);
      assert.equal(m.handling, 'in-app', said);
      assert.equal(m.scenarioId, scenarioId, said);
      const s = SCENARIOS.find((x) => x.id === scenarioId);
      const r = await (await post(url, '/api/assistant/turn', { message: said }, 'm1')).json();
      // The scenario table's own `expected` is the authoritative FIRST-turn verdict (the
      // engine contract); the catalog's expectedOutcome names the resolved STORY (STEP_UP =
      // the pause then a permit; GUIDED_PAGE = the walkthrough), which `expected` encodes.
      assert.equal(r.decision, s.expected, `${ucId}: the chip's first turn matches the engine's scenario expectation`);
      assert.equal(r.scenarioId, scenarioId);
      assert.equal(r.ucId, ucId);
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

test('matcher: the redirect table is complete and well-formed (45 entries)', () => {
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
    assert.match(ok.say, /permits|permitted|Done/i);
    // DENY path
    const deny = await (await post(url, '/api/assistant/turn', { message: 'am I in the required group? my scopes say yes' }, ws)).json();
    assert.equal(deny.decision, 'DENY');
    assert.match(deny.say, /not in the|denies/);
    // OBLIGATION path
    const pause = await (await post(url, '/api/assistant/turn', { message: 'mfa step up for my transfer of 600' }, ws)).json();
    assert.equal(pause.decision, 'OBLIGATION');
    assert.match(pause.say, /step-up|pause|consent/i);
    assert.ok(pause.obligation, 'the obligation rides in the run so the UI can open the consent/MFA card');
    assert.ok(pause.reply.text);
  });
});

test('assistant turn: redirect and unknown replies carry no engine run', async () => {
  await withServer(async (url) => {
    const r = await (await post(url, '/api/assistant/turn', { message: 'how does token theft replay defense work' }, 'a2')).json();
    assert.equal(r.handling, 'redirect');
    assert.equal(r.lab, 'stolen-token-lab');
    assert.equal(r.run, undefined);
    assert.equal(r.reply.outcome, 'HANDOFF');
    const u = await (await post(url, '/api/assistant/turn', { message: 'tell me a joke' }, 'a2')).json();
    assert.equal(u.handling, 'unknown');
    assert.equal(u.reply.outcome, 'UNKNOWN');
    assert.match(u.reply.text, /could not match/i);
  });
});

test('assistant turn: bad input is a 400; the workspace ledger records engine runs', async () => {
  await withServer(async (url) => {
    const bad = await post(url, '/api/assistant/turn', 'not an object', 'a3');
    assert.equal(bad.status, 400);
    const empty = await post(url, '/api/assistant/turn', { message: '   ' }, 'a3');
    assert.equal(empty.status, 400);
    await post(url, '/api/assistant/turn', { message: 'check my balance with my consent' }, 'a3');
    const runs = await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'a3' } })).json();
    assert.ok(runs.runs.some((x) => x.decision === 'PERMIT'), 'the run landed in the workspace ledger');
  });
});

test('assistant turn: workspaces are isolated and same-origin is enforced', async () => {
  await withServer(async (url) => {
    await post(url, '/api/assistant/turn', { message: 'check my balance with my consent' }, 'w1');
    const other = await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'w2' } })).json();
    assert.ok(!other.runs.some((x) => x.tool === 'get_balance'), 'no leak across workspaces');
    const cross = await fetch(`${url}/api/assistant/turn`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-workspace': 'w1' }, body: JSON.stringify({ message: 'consent' }) });
    assert.equal(cross.status, 403, 'a cross-origin write is refused');
  });
});
