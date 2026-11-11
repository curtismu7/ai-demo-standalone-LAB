import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';

const post = (url, p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });

test('UC7: $600 mid-band transfer returns a STEP_UP obligation; the MFA receipt re-evaluates to PERMIT', async () => {
  await withServer(async (url) => {
    const ws = 'h1';
    const { token } = await (await post(url, '/api/consent', { user: 'demoUser', actor: 'demo-agent' }, ws)).json();
    // band the amount: step-up
    const j = await (await post(url, '/api/authorize', { token, tool: 'get_transactions', amount: 600 }, ws)).json();
    assert.equal(j.decision, 'OBLIGATION');
    assert.equal(j.obligation, 'STEP_UP');
    assert.equal(j.code, 'STEP_UP');
    assert.match(j.reason, /consent \+ MFA/);
    assert.match(j.lesson, /pause, not a denial/);
    assert.ok(j.narrative[0].what.includes('cannot self-approve'));
    assert.equal(j.hops[j.hops.length - 1].response.includes('202'), true, 'the response hop is the 202 pause');
    // raise the challenge, answer wrong, then right
    const c = await (await post(url, '/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 }, ws)).json();
    assert.equal(c.challenge.needs.includes('mfa'), true);
    const bad = await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true, otp: '999999' } }, ws);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'otp_invalid');
    const good = await (await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true, otp: '123123' } }, ws)).json();
    assert.equal(good.receipt.claims.MfaVerified, true);
    // receipt re-evaluates the SAME call
    const done = await (await post(url, '/api/authorize', { token, tool: 'get_transactions', amount: 600, receipt: good.receipt }, ws)).json();
    assert.equal(done.decision, 'PERMIT');
    assert.match(done.reason, /satisfied by a bound receipt/);
    // the receipt cannot be replayed for a different amount
    const again = await (await post(url, '/api/authorize', { token, tool: 'get_transactions', amount: 700, receipt: good.receipt }, ws)).json();
    assert.equal(again.decision, 'OBLIGATION', 'a different amount does not match the bound receipt');
  });
});

test('UC8: a HITL tool always obliges; only a HitlApproved receipt permits; an approval is never an MFA', async () => {
  await withServer(async (url) => {
    const ws = 'h2';
    const { token } = await (await post(url, '/api/consent', { user: 'demoUser', actor: 'demo-agent' }, ws)).json();
    const j = await (await post(url, '/api/authorize', { token, tool: 'create_transfer', amount: 100 }, ws)).json();
    assert.equal(j.decision, 'OBLIGATION');
    assert.equal(j.obligation, 'HITL_CONSENT');
    assert.match(j.lesson, /approval is never an MFA/);
    const c = await (await post(url, '/api/challenge', { user: 'demoUser', tool: 'create_transfer', amount: 100 }, ws)).json();
    assert.deepEqual(c.challenge.needs, ['consent'], 'HITL needs consent only — never an MFA challenge');
    const a = await (await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true } }, ws)).json();
    assert.equal(a.receipt.claims.HitlApproved, true);
    const done = await (await post(url, '/api/authorize', { token, tool: 'create_transfer', amount: 100, receipt: a.receipt }, ws)).json();
    assert.equal(done.decision, 'PERMIT');
    // a spent challenge cannot mint a second receipt
    const spent = await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true } }, ws);
    assert.equal(spent.status, 400);
    assert.equal((await spent.json()).error, 'challenge_spent');
  });
});

test('UC22: CIBA for agent-initiated sensitive actions; out-of-band approval, receipt re-evaluates', async () => {
  await withServer(async (url) => {
    const ws = 'h3';
    const { token } = await (await post(url, '/api/consent', { user: 'demoUser', actor: 'demo-agent' }, ws)).json();
    const j = await (await post(url, '/api/authorize', { token, tool: 'move_money' }, ws)).json();
    assert.equal(j.decision, 'OBLIGATION');
    assert.equal(j.obligation, 'CIBA');
    assert.match(j.lesson, /no browser/);
    const c = await (await post(url, '/api/challenge', { user: 'demoUser', tool: 'move_money' }, ws)).json();
    assert.ok(c.challenge.authReqId && c.challenge.authReqId.startsWith('ciba_'), 'CIBA carries an auth_req_id');
    const pending = await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true } }, ws);
    assert.equal((await pending.json()).error, 'ciba_pending', 'consent alone does not satisfy CIBA');
    const a = await (await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { cibaApproved: true } }, ws)).json();
    assert.equal(a.receipt.claims.CibaApproved, true);
    const done = await (await post(url, '/api/authorize', { token, tool: 'move_money', receipt: a.receipt }, ws)).json();
    assert.equal(done.decision, 'PERMIT');
  });
});

test('receipts are bound: wrong user, tool, obligation or absence all keep the call paused', async () => {
  await withServer(async (url) => {
    const ws = 'h4';
    const { token } = await (await post(url, '/api/consent', { user: 'demoUser', actor: 'demo-agent' }, ws)).json();
    const c = await (await post(url, '/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 }, ws)).json();
    const a = await (await post(url, '/api/challenge/answer', { challenge: c.challenge, answer: { consent: true, otp: '123123' } }, ws)).json();
    // a receipt for premiumUser does not help demoUser (receipt binding, not the group gate)
    const { token: pt } = await (await post(url, '/api/consent', { user: 'premiumUser', actor: 'demo-agent' }, ws)).json();
    const stolen = await (await post(url, '/api/authorize', { token: pt, tool: 'get_transactions', amount: 600, receipt: a.receipt }, ws)).json();
    assert.equal(stolen.decision, 'OBLIGATION', 'another user cannot present someone else\'s receipt');
    // no receipt keeps the pause
    const none = await (await post(url, '/api/authorize', { token, tool: 'get_transactions', amount: 600 }, ws)).json();
    assert.equal(none.decision, 'OBLIGATION');
  });
});

test('UC2/2.6/2.7: A2A handoff in-process — nested chain permits, unregistered specialist denies, no bearer is 401', async () => {
  await withServer(async (url) => {
    const ws = 'h5';
    const card = await (await fetch(`${url}/api/a2a/agent-card`)).json();
    assert.equal(card.name, 'Generalist Banking Agent');
    const t1 = await (await post(url, '/api/a2a/exchange/one', { user: 'demoUser' }, ws)).json();
    assert.equal(t1.token.act.sub, 'generalist-agent');
    const t2 = await (await post(url, '/api/a2a/exchange/two', { generalistToken: t1.token, specialist: 'portfolio-specialist' }, ws)).json();
    assert.equal(t2.token.act.act.sub, 'generalist-agent', 'nested chain');
    const ok = await (await post(url, '/api/a2a/tool', { token: t2.token }, ws)).json();
    assert.equal(ok.decision, 'PERMIT');
    assert.equal(ok.chainDepth, 2);
    const t3 = await (await post(url, '/api/a2a/exchange/two', { generalistToken: t1.token, specialist: 'rogue-specialist' }, ws)).json();
    const d = await (await post(url, '/api/a2a/tool', { token: t3.token }, ws)).json();
    assert.equal(d.code, 'unregistered_specialist');
    // registry flip moves the next decision
    await post(url, '/api/a2a/registry/set', { specialist: 'rogue-specialist', registered: true }, ws);
    const t4 = await (await post(url, '/api/a2a/exchange/two', { generalistToken: t1.token, specialist: 'rogue-specialist' }, ws)).json();
    assert.equal((await (await post(url, '/api/a2a/tool', { token: t4.token }, ws)).json()).decision, 'PERMIT');
    // the 401 protocol beat
    const r = await post(url, '/api/a2a/tool', { tool: 'get_portfolio_summary' }, ws);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') || '', /Bearer realm="ai-demo-standalone"/);
  });
});
