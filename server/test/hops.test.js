// P3: the demo-hop adapter. Every hop the adapter emits across ALL 11 scenarios must
// pass the vendored validateHop; skip hops carry no traceparent and empty request and
// response; every kind exists in the vendored catalog; the 10 chain-map steps derive
// correctly for a PERMIT, an OBLIGATION and a DENY run; the token cards carry the diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDemoHops, buildTokenCards, tokenDiff, CHAIN_STEPS, deriveChainSteps } from '../src/hops.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import { newTrace } from '../src/explain.js';
import { SCENARIOS } from '../src/policyData.js';
import { matchTurn } from '../src/assistant.js';
import { decideWithObligation } from '../src/pdp.js';
import { seedFor, tokenFor } from '../src/scenario.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/vendor/hop-catalog.json', import.meta.url), 'utf8'));

// Run each scenario through the REAL engine (the same seeding /api/assistant/turn applies
// — the SHARED seeding rule, so the tests cannot drift from the endpoint) and adapt; this
// is the fixture factory the assertions below share.
function runScenario(scenarioId) {
  const sc = SCENARIOS.find((s) => s.id === scenarioId);
  assert.ok(sc, scenarioId);
  const { groups, tier } = seedFor(sc);
  const token = tokenFor(sc);
  const amount = sc.amount ?? null;
  const { verdict, obligation } = decideWithObligation({
    token, groups, tier, tool: sc.tool, amount, resourceOwner: sc.resourceOwner ?? null,
    receipts: null, now: () => Date.now(),
  });
  const trace = newTrace();
  const ctx = { verdict, user: sc.user, actor: sc.actor, tool: sc.tool, amount, token, trace, aud: sc.aud };
  return { sc, verdict, obligation, hops: buildDemoHops(ctx), tokens: buildTokenCards(ctx) };
}

const ALL = SCENARIOS.map((s) => s.id);

test('every hop the adapter emits across all 11 scenarios passes the vendored validateHop', () => {
  let count = 0;
  for (const id of ALL) {
    const { hops } = runScenario(id);
    assert.ok(hops.length === 10, `${id}: the adapter emits the 10 chain hops (got ${hops.length})`);
    for (const h of hops) {
      const problems = validateHop(h, catalog, { tokens: 'raw' });
      assert.deepEqual(problems, [], `${id} hop ${h.n} (${h.kind}): ${problems.join('; ')}`);
      count += 1;
    }
  }
  assert.ok(count >= 110, `the sweep covered every scenario hop (${count})`);
});

test('every hop kind exists in the vendored catalog', () => {
  for (const id of ALL) {
    const { hops } = runScenario(id);
    for (const h of hops) assert.ok(Object.hasOwn(catalog.kinds, h.kind), `${h.kind} is a catalog kind`);
  }
});

test('skip hops carry no traceparent and an empty request and response', async () => {
  // An exchange the consent path skipped: consent=false mints hop 6 as a skip.
  const trace = newTrace();
  const hops = buildDemoHops({
    verdict: { decision: 'PERMIT', stage: 'policy', code: null, reason: 'ok' },
    user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
    token: { sub: 'demoUser', act: { sub: 'demo-agent' }, aud: 'ai-demo-standalone' }, trace, consent: false,
  });
  const skip = hops.find((h) => h.kind === 'token-exchange');
  assert.equal(skip.verdict, 'skip');
  assert.equal(skip.traceparent, undefined, 'a skip hop carries no traceparent');
  assert.deepEqual(skip.request, {});
  assert.deepEqual(skip.response, {});
  // and every non-skip hop DOES carry one
  for (const h of hops.filter((x) => x.verdict !== 'skip')) assert.match(h.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('the 10 chain-map steps derive for a PERMIT run: all ten ok', () => {
  const { hops } = runScenario('uc1');
  const steps = deriveChainSteps(hops);
  assert.equal(steps.length, 10);
  assert.deepEqual(steps.map((s) => s.id), CHAIN_STEPS.map((s) => s.id));
  for (const s of steps) assert.equal(s.state, 'ok', `${s.id} is ok on a PERMIT run`);
  assert.deepEqual(steps.map((s) => s.hopN), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the 10 chain-map steps derive for an OBLIGATION run: authorize and tool held', () => {
  const { hops } = runScenario('uc7-stepup');
  const steps = Object.fromEntries(deriveChainSteps(hops).map((s) => [s.id, s]));
  assert.equal(steps.authorize.state, 'held');
  assert.equal(steps.tool.state, 'held');
  assert.equal(steps.signin.state, 'ok');
  assert.equal(steps.gateway.state, 'ok');
});

test('the 10 chain-map steps derive for DENY runs: gateway denies mark the right steps', () => {
  // policy deny (uc9): authorize denied, tool denied, nothing skipped
  const a = runScenario('uc9');
  const sa = Object.fromEntries(deriveChainSteps(a.hops).map((s) => [s.id, s]));
  assert.equal(a.verdict.decision, 'DENY');
  assert.equal(sa.authorize.state, 'deny');
  assert.equal(sa.tool.state, 'deny');
  assert.equal(sa.exchange.state, 'ok');
  // gateway deny (uc6-rogue): authorize and tool are NOT IN RUN
  const b = runScenario('uc6-rogue');
  const sb = Object.fromEntries(deriveChainSteps(b.hops).map((s) => [s.id, s]));
  assert.equal(sb.gateway.state, 'deny');
  assert.equal(sb.authorize.state, 'not-in-run');
  assert.equal(sb.tool.state, 'not-in-run');
  assert.equal(sb.signin.state, 'ok');
});

test('the verdict vocabulary is exactly ok|deny|held|obligation|skip', () => {
  const allowed = new Set(['ok', 'deny', 'held', 'obligation', 'skip']);
  for (const id of ALL) {
    for (const h of runScenario(id).hops) assert.ok(allowed.has(h.verdict), `${h.kind}: ${h.verdict}`);
  }
});

test('token cards: all mock, raw claims; the delegated card diffs act added / aud rebound / scope narrowed', () => {
  const { tokens } = runScenario('uc1');
  assert.equal(tokens.length, 3);
  for (const t of tokens) {
    assert.equal(t.mock, true, `${t.id} is labelled mock`);
    assert.ok(t.claims && typeof t.claims === 'object');
    assert.ok(t.title && t.role);
  }
  const delegated = tokens.find((t) => t.id === 'delegated-token');
  assert.ok(delegated.diff, 'the delegated token carries a diff');
  assert.ok(delegated.diff.added.includes('act'), 'act added');
  assert.deepEqual(delegated.diff.rebound, [], 'the aud stays this app (the exchange binds it to the same resource here)');
  assert.deepEqual(delegated.diff.narrowed, ['scope'], 'scope narrowed');
  assert.ok(delegated.claims.act?.sub, 'the delegated claims name the actor');
});

test('tokenDiff: an upstream audience run shows aud rebound', () => {
  const d = tokenDiff({ aud: 'ai-demo-standalone', scope: 'openid accounts:read' }, { aud: 'mcp-weather.internal', scope: 'accounts:read' });
  assert.deepEqual(d.rebound, ['aud']);
  assert.deepEqual(d.narrowed, ['scope']);
});

test('the matcher feeds every in-app scenario through the adapter without a validateHop problem', () => {
  // the same sweep, driven from what a visitor can actually TYPE (the matcher rows)
  for (const said of ['check my balance', 'am I in the required group?', 'flip the directory entry',
    'can I use the premium wire?', 'promote me to premium', 'send 60000', 'unknown agent alert',
    'upstream mcp token', 'mfa step up', 'who can approve a transfer?', 'ciba approval on my phone']) {
    const m = matchTurn(said);
    if (m.handling !== 'in-app') continue;
    const { hops } = runScenario(m.scenarioId);
    for (const h of hops) assert.deepEqual(validateHop(h, catalog, { tokens: 'raw' }), [], `${said} hop ${h.n}`);
  }
});
