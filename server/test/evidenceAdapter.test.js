// P3 evidence adapter: engine hops + the exchange result become demo-hop/1 the vendored
// evidence views and token cards render. The tests prove the contract the plan names:
// validateHop passes for every run shape, tokens are raw and MOCK-labelled, the act diff
// is lab-own (act added, aud rebound), and the adapter never invents a hop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDemoHops, tokenCardsFrom, validateRun } from '../src/evidenceAdapter.js';
import { buildHops, newTrace } from '../src/explain.js';
import { exchange } from '../src/pdp.js';

const token = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', aud: 'ai-demo-standalone' });
const run = (verdict, consent = true) => buildHops({
  verdict, user: 'demoUser', actor: 'demo-agent', tool: 'get_balance', amount: null,
  token, trace: newTrace(undefined), aud: 'ai-demo-standalone', consent,
});

const PERMIT = { decision: 'PERMIT', stage: 'policy', code: null, reason: 'demoUser -> get_balance: allowed', stages: [] };
const DENY_GW = { decision: 'DENY', stage: 'gateway', code: 'actor_not_allowed', reason: 'refused', stages: [] };
const DENY_POLICY = { decision: 'DENY', stage: 'policy', code: 'group_required', reason: 'refused', stages: [] };
const DENY_PROTO = { decision: 'DENY', stage: 'protocol', code: 'no_token', reason: 'refused', stages: [] };
const OBLIGATION = { decision: 'OBLIGATION', stage: 'policy', code: 'hitl_required', reason: 'paused', stages: [] };

test('validateHop passes for every run shape the engine can emit', () => {
  for (const [name, verdict] of [['PERMIT', PERMIT], ['DENY-gateway', DENY_GW], ['DENY-policy', DENY_POLICY], ['DENY-protocol', DENY_PROTO], ['OBLIGATION', OBLIGATION]]) {
    const hops = toDemoHops(run(verdict), { decision: verdict.decision });
    assert.deepEqual(validateRun(hops), [], `${name}: every hop is valid demo-hop/1`);
  }
});

test('no-consent runs (protocol-stage denies) also validate', () => {
  const hops = toDemoHops(run(DENY_PROTO, false), { decision: 'DENY' });
  assert.deepEqual(validateRun(hops), []);
  assert.ok(hops.every((h) => typeof h.traceparent === 'string' && h.traceparent.startsWith('00-')), 'every hop keeps its traceparent');
});

test('every hop carries kind, lanes, a fact and a title from the catalog', () => {
  const hops = toDemoHops(run(PERMIT), { decision: 'PERMIT' });
  for (const h of hops) {
    assert.ok(h.kind, `hop ${h.n}: kind`);
    assert.ok(h.from && h.to, `hop ${h.n}: lanes`);
    assert.ok(h.fact, `hop ${h.n}: fact`);
    assert.ok(h.title, `hop ${h.n}: title`);
  }
  assert.equal(hops[0].kind, 'consent', 'the exchange is the first hop when consent ran');
});

test('deny runs mark the refusal hops deny; permit hops read ok', () => {
  const deny = toDemoHops(run(DENY_GW), { decision: 'DENY' });
  assert.ok(deny.some((h) => h.kind === 'tool-refused' && h.verdict === 'deny'), 'a refusal hop exists and reads deny');
  const permit = toDemoHops(run(PERMIT), { decision: 'PERMIT' });
  assert.ok(permit.every((h) => h.verdict !== 'deny'), 'no permit hop reads deny');
});

test('token cards: raw claims, MOCK-labelled, the act diff is act added + aud rebound', () => {
  const cards = tokenCardsFrom({ exchangeToken: token });
  assert.equal(cards.length, 1);
  const [ex] = cards;
  assert.equal(ex.mock, true, 'labelled MOCK');
  assert.equal(ex.claims.act.sub, 'demo-agent', 'raw act claim present');
  assert.deepEqual(ex.diff, { added: ['act'], rebound: ['aud'], narrowed: [] });
  // no raw JWT strings anywhere: the lab mints claim objects, never signed tokens
  const flat = JSON.stringify(cards);
  assert.ok(!flat.includes('eyJ'), 'no signed-JWT-looking string in the cards');
});

test('the adapter never invents a hop: output length equals input length, labels preserved', () => {
  const raw = run(PERMIT);
  const hops = toDemoHops(raw, { decision: 'PERMIT' });
  assert.equal(hops.length, raw.length);
  hops.forEach((h, i) => assert.equal(h.label, raw[i].label, `hop ${i + 1}: label preserved verbatim`));
});
