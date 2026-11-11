// Receipts and challenges are issued by the server and checked against its per-workspace store:
// forged, replayed, expired and mismatched receipts leave the call paused; MfaVerified is true
// only after a verified MFA answer; there is no separate hard-deny band above the tier ceilings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { createWorkspaces } from '../src/workspaces.js';
import { createRegistry } from '../src/a2a.js';
import { DEFAULT_DIRECTORY } from '../src/pdpData.js';
import { rawStory } from '../src/story.js';
import { exchange, decideWithObligation } from '../src/pdp.js';
import { BANDS, STORE_MAX, TTL_SECONDS, answerChallenge, createChallenge, createReceipts, evaluateObligation, mintReceipt, verifyAnswer } from '../src/hitl.js';

const CONSENT = { consent: true };
const MFA = { consent: true, otp: '123123' };
const CIBA = { cibaApproved: true };

// One workspace as a caller sees it: token, receipt and authorize calls over HTTP.
const session = (url, ws) => {
  const send = async (p, body) => {
    const r = await fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() };
  };
  const amountOf = (amount) => (amount == null ? {} : { amount });
  return {
    send,
    token: async (user = 'demoUser') => (await send('/api/consent', { user, actor: 'demo-agent' })).j.token,
    // raise a challenge for the call and answer it: the receipt the server issued
    receipt: async ({ user = 'demoUser', tool, amount, answer }) => {
      const ch = (await send('/api/challenge', { user, tool, ...amountOf(amount) })).j.challenge;
      return (await send('/api/challenge/answer', { challenge: ch, answer })).j.receipt;
    },
    authorize: (token, tool, amount, receipt, extra = {}) => send('/api/authorize', { token, tool, ...amountOf(amount), ...(receipt ? { receipt } : {}), ...extra }),
  };
};

// A receipt written by hand with every field right, as an attacker would.
const forge = ({ obligation, tool, amount = null, user = 'demoUser', claims }) => ({
  receiptId: 'rcp_forgedforged', challengeId: 'chg_forged', obligation, user, tool, amount,
  issuedAt: Math.floor(Date.now() / 1000), claims,
});

const paused = (r, code) => {
  assert.equal(r.status, 202, `expected the call to stay paused, got ${r.status} ${r.j.decision}`);
  assert.equal(r.j.decision, 'OBLIGATION');
  assert.equal(r.j.receiptCheck.valid, false);
  assert.equal(r.j.receiptCheck.code, code);
  assert.match(r.j.reason, /receipt was refused/);
};

test('defect 1: a forged receipt that this server never issued is refused, whatever band it claims', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r1');
    const t = await s.token();
    const cases = [
      { obligation: 'CONFIRM', tool: 'get_transactions', amount: 300, claims: { MfaVerified: true, ConsentGiven: true } },
      { obligation: 'STEP_UP', tool: 'get_transactions', amount: 600, claims: { MfaVerified: true, ConsentGiven: true } },
      { obligation: 'HITL_CONSENT', tool: 'create_transfer', amount: 100, claims: { HitlApproved: true } },
      { obligation: 'CIBA', tool: 'move_money', amount: null, claims: { CibaApproved: true } },
    ];
    for (const c of cases) paused(await s.authorize(t, c.tool, c.amount, forge(c)), 'receipt_not_found');
    // a receipt id lifted from ANOTHER workspace's real receipt is not this workspace's either
    const other = session(url, 'r1-other');
    const real = await other.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    paused(await s.authorize(t, 'get_transactions', 600, real), 'receipt_not_found');
    // the refusals did not poison anything: the genuine path in this workspace still works
    const mine = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    assert.equal((await s.authorize(t, 'get_transactions', 600, mine)).status, 200);
  });
});

test('a tampered copy of a real receipt cannot widen it: the server compares against what it stored', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r2');
    const t = await s.token();
    const real = await s.receipt({ tool: 'get_transactions', amount: 300, answer: CONSENT });
    const widened = { ...real, amount: 600, obligation: 'STEP_UP', claims: { MfaVerified: true, ConsentGiven: true } };
    // editing any field breaks the workspace HMAC, so the signature check refuses before the binding check
    paused(await s.authorize(t, 'get_transactions', 600, widened), 'receipt_forged');
    // the real receipt was not burned by the attempt
    assert.equal((await s.authorize(t, 'get_transactions', 300, real)).status, 200);
  });
});

test('defect 2: a receipt permits ONE call; presenting it again is refused', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r3');
    const t = await s.token();
    const rc = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    const first = await s.authorize(t, 'get_transactions', 600, rc);
    assert.equal(first.status, 200);
    assert.equal(first.j.decision, 'PERMIT');
    assert.match(first.j.reason, /satisfied by a bound receipt/);
    assert.match(first.j.reason, /receipt consumed/);
    paused(await s.authorize(t, 'get_transactions', 600, rc), 'receipt_spent');
    paused(await s.authorize(await s.token(), 'get_transactions', 600, rc), 'receipt_spent');
    // every kind of obligation is single-use
    for (const c of [
      { tool: 'create_transfer', amount: 100, answer: CONSENT },
      { tool: 'move_money', amount: null, answer: CIBA },
      { tool: 'get_transactions', amount: 300, answer: CONSENT },
    ]) {
      const r = await s.receipt(c);
      assert.equal((await s.authorize(t, c.tool, c.amount, r)).status, 200, c.tool);
      paused(await s.authorize(t, c.tool, c.amount, r), 'receipt_spent');
    }
  });
});

test('three parallel presentations of one receipt: exactly one permits', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r4');
    const t = await s.token();
    const rc = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    const rs = await Promise.all([1, 2, 3].map(() => s.authorize(t, 'get_transactions', 600, rc)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 202, 202]);
  });
});

test('a receipt for another user, tool or amount is refused, and a refused attempt does not burn it', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r5');
    const t = await s.token();
    const rc = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    paused(await s.authorize(await s.token('premiumUser'), 'get_transactions', 600, rc), 'receipt_user_mismatch');
    paused(await s.authorize(t, 'get_balance', 600, rc), 'receipt_tool_mismatch');
    paused(await s.authorize(t, 'get_transactions', 700, rc), 'receipt_amount_mismatch');
    assert.equal((await s.authorize(t, 'get_transactions', 600, rc)).status, 200, 'the right call still permits');
  });
});

test('amount binding: approve $300, call $600 is refused; so is $300 -> $400, and a missing amount never matches a number', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r6');
    const t = await s.token();
    const r300 = await s.receipt({ tool: 'get_transactions', amount: 300, answer: CONSENT });
    paused(await s.authorize(t, 'get_transactions', 600, r300), 'receipt_amount_mismatch');
    paused(await s.authorize(t, 'get_transactions', 400, r300), 'receipt_amount_mismatch');
    assert.equal((await s.authorize(t, 'get_transactions', 300, r300)).status, 200);
    // approved with an amount, called with none
    const r100 = await s.receipt({ tool: 'create_transfer', amount: 100, answer: CONSENT });
    paused(await s.authorize(t, 'create_transfer', null, r100), 'receipt_amount_mismatch');
    // approved with no amount, called with $1500
    const rNone = await s.receipt({ tool: 'create_transfer', amount: null, answer: CONSENT });
    paused(await s.authorize(t, 'create_transfer', 1500, rNone), 'receipt_amount_mismatch');
    assert.equal((await s.authorize(t, 'create_transfer', null, rNone)).status, 200, 'no amount matches no amount');
  });
});

test('an expired receipt is refused (5 minutes)', async () => {
  let skewMs = 0;
  const workspaces = createWorkspaces({
    makeDirectory: () => structuredClone(DEFAULT_DIRECTORY),
    makeExtra: () => ({ receipts: createReceipts({ now: () => Date.now() + skewMs }), registry: createRegistry({}), generalistToken: null }),
  });
  await withServer(async (url) => {
    const s = session(url, 'r7');
    const t = await s.token();
    const fresh = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    skewMs = (TTL_SECONDS - 5) * 1000;
    assert.equal((await s.authorize(t, 'get_transactions', 600, fresh)).status, 200, 'still valid just inside 5 minutes');
    skewMs = 0;
    const stale = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    skewMs = (TTL_SECONDS + 1) * 1000;
    paused(await s.authorize(t, 'get_transactions', 600, stale), 'receipt_expired');
    // a challenge expires too: answering it after 5 minutes issues nothing
    skewMs = 0;
    const ch = (await s.send('/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 })).j.challenge;
    skewMs = (TTL_SECONDS + 1) * 1000;
    const late = await s.send('/api/challenge/answer', { challenge: ch, answer: MFA });
    assert.equal(late.status, 400);
    assert.equal(late.j.error, 'challenge_expired');
  }, { workspaces });
});

test('defect 4: MfaVerified is true only on a receipt that came from a verified MFA answer', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r8');
    const t = await s.token();
    // CONFIRM band: consent only, no MFA, so MfaVerified is false
    const confirm = await s.receipt({ tool: 'get_transactions', amount: 300, answer: CONSENT });
    assert.equal(confirm.obligation, 'CONFIRM');
    assert.equal(confirm.claims.MfaVerified, false);
    assert.equal(confirm.claims.ConsentGiven, true);
    const used = await s.authorize(t, 'get_transactions', 300, confirm);
    assert.equal(used.status, 200);
    assert.doesNotMatch(used.j.reason, /MfaVerified=true/);
    assert.match(used.j.reason, /MfaVerified=false, ConsentGiven=true/);
    // STEP_UP: a wrong OTP issues no receipt; the right one issues MfaVerified=true
    const ch = (await s.send('/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 })).j.challenge;
    const bad = await s.send('/api/challenge/answer', { challenge: ch, answer: { consent: true, otp: '000000' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.j.receipt, undefined);
    const stepUp = (await s.send('/api/challenge/answer', { challenge: ch, answer: MFA })).j.receipt;
    assert.equal(stepUp.obligation, 'STEP_UP');
    assert.deepEqual(stepUp.claims, { MfaVerified: true, ConsentGiven: true });
    assert.match((await s.authorize(t, 'get_transactions', 600, stepUp)).j.reason, /MfaVerified=true, ConsentGiven=true/);
    // approval and out-of-band receipts never claim an MFA
    for (const c of [{ tool: 'create_transfer', amount: 100, answer: CONSENT }, { tool: 'move_money', amount: null, answer: CIBA }]) {
      assert.notEqual((await s.receipt(c)).claims.MfaVerified, true, c.tool);
    }
  });
});

test('MfaVerified at the unit level: mintReceipt defaults to false and only a verified MFA answer sets it', () => {
  const stepUp = createChallenge({ obligation: 'STEP_UP', user: 'demoUser', tool: 'get_transactions', amount: 600 });
  const confirm = createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_transactions', amount: 300 });
  assert.equal(mintReceipt({ challenge: stepUp }).claims.MfaVerified, false, 'no verified-MFA flag, no MfaVerified');
  assert.equal(verifyAnswer({ challenge: stepUp, answer: MFA }).mfaVerified, true);
  assert.equal(verifyAnswer({ challenge: confirm, answer: CONSENT }).mfaVerified, false);
  assert.equal(verifyAnswer({ challenge: stepUp, answer: { consent: true, otp: 'nope' } }).ok, false);
});

test('a challenge the server did not issue, or one edited in transit, cannot mint a receipt', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r9');
    // never issued, with needs emptied so there is nothing to satisfy
    const made = { challengeId: 'chg_madeup', obligation: 'STEP_UP', user: 'demoUser', tool: 'get_transactions', amount: 600, needs: [], createdAt: 1, expiresAt: 9999999999, authReqId: null };
    const unknown = await s.send('/api/challenge/answer', { challenge: made, answer: {} });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.j.error, 'challenge_unknown');
    assert.equal(unknown.j.receipt, undefined);
    // a real STEP_UP challenge with its needs and band edited: the stored copy decides
    const real = (await s.send('/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 })).j.challenge;
    const edited = { ...real, needs: [], obligation: 'CONFIRM', amount: 1, expiresAt: 9999999999 };
    const refused = await s.send('/api/challenge/answer', { challenge: edited, answer: {} });
    assert.equal(refused.status, 400);
    assert.equal(refused.j.error, 'consent_required');
    // a challenge raised in another workspace is unknown here
    const elsewhere = (await session(url, 'r9-other').send('/api/challenge', { user: 'demoUser', tool: 'get_transactions', amount: 600 })).j.challenge;
    assert.equal((await s.send('/api/challenge/answer', { challenge: elsewhere, answer: MFA })).j.error, 'challenge_unknown');
    // the real one still answers once
    assert.equal((await s.send('/api/challenge/answer', { challenge: real, answer: MFA })).status, 200);
    assert.equal((await s.send('/api/challenge/answer', { challenge: real, answer: MFA })).j.error, 'challenge_spent');
  });
});

test('Reset clears the workspace: its pending challenges and receipts are gone', async () => {
  await withServer(async (url) => {
    const s = session(url, 'r10');
    const rc = await s.receipt({ tool: 'get_transactions', amount: 600, answer: MFA });
    await s.send('/api/reset', {});
    paused(await s.authorize(await s.token(), 'get_transactions', 600, rc), 'receipt_not_found');
  });
});

test('defect 3: there is no separate hard-deny band; the tier ceilings are the hard limits', async () => {
  assert.deepEqual(Object.keys(BANDS), ['confirm', 'stepUp']);
  assert.equal(evaluateObligation({ tool: 'get_transactions', amount: 150000 }).obligation, 'STEP_UP', 'the obligation layer has no DENY outcome');
  await withServer(async (url) => {
    const s = session(url, 'r11');
    const premium = await s.authorize(await s.token('premiumUser'), 'get_transactions', 150000);
    assert.equal(premium.status, 403);
    assert.equal(premium.j.code, 'tier_amount_exceeded');
    assert.match(premium.j.reason, /Premium.*ceiling of \$50000/);
    const standard = await s.authorize(await s.token('demoUser'), 'get_transactions', 2500);
    assert.equal(standard.j.code, 'tier_amount_exceeded');
    assert.match(standard.j.reason, /Standard.*ceiling of \$2000/);
    // no page text, scenario lesson or narrative names the removed band
    const gone = /100000|100,000|hard deny|deny ceiling/i;
    assert.doesNotMatch(JSON.stringify(rawStory()), gone);
    assert.doesNotMatch(JSON.stringify((await s.authorize(await s.token(), 'get_transactions', 600)).j), gone);
  });
});

test('scenario outcomes are unchanged: the originals give the same decisions, every pause resolves with a receipt, and the P6 additions permit', async () => {
  const expected = {
    uc1: [200, 'PERMIT', null, 'policy'],
    uc9: [403, 'DENY', 'group_entitlement', 'policy'],
    uc9a: [403, 'DENY', 'group_entitlement', 'policy'],
    'uc21-tool': [403, 'DENY', 'tier_tool_not_allowed', 'policy'],
    'uc21-promote': [202, 'OBLIGATION', 'HITL_CONSENT', 'policy'],
    'uc21-ceiling': [403, 'DENY', 'tier_amount_exceeded', 'policy'],
    'uc3-actgate': [200, 'PERMIT', null, 'policy'],
    'uc6-rogue': [403, 'DENY', 'unauthorized_actor', 'gateway'],
    'uc32-upstream': [403, 'DENY', 'upstream_audience', 'gateway'],
    'uc19-lifecycle': [200, 'PERMIT', null, 'policy'],
    'uc20-trace': [200, 'PERMIT', null, 'policy'],
    'uc33-mortgage': [200, 'PERMIT', null, 'policy'],
    'uc34-patterns': [200, 'PERMIT', null, 'policy'],
    'uc35-why': [200, 'PERMIT', null, 'policy'],
    'uc7-stepup': [202, 'OBLIGATION', 'STEP_UP', 'policy'],
    // P6 batch 2 (attacks) ride the turn/seeded path; their outcomes are pinned in p6Attacks.test.js
    'uc5-scope': [403, 'DENY', 'insufficient_scope', 'gateway'],
    'uc10-takeover': [403, 'DENY', 'resource_owner_mismatch', 'policy'],
    'uc11-badclient': [403, 'DENY', 'bad_audience', 'gateway'],
    'uc13-deputy': [403, 'DENY', 'unauthorized_actor', 'gateway'],
    'uc16b-forward': [403, 'DENY', 'user_token_forwarding_disabled', 'gateway'],
    'uc29-outage': [403, 'DENY', 'validation_unavailable', 'gateway'],
    'uc8-hitl': [202, 'OBLIGATION', 'HITL_CONSENT', 'policy'],
    'uc22-ciba': [202, 'OBLIGATION', 'CIBA', 'policy'],
    // P6 batch 3 (final), in table order; UC41/UC42/UC27 ride the turn/seeded path
    // (query/consentGiven are scenario arguments), pinned in p6Batch3.test.js
    'uc4-overscoped': [200, 'PERMIT', null, 'policy'],
    'uc41-search': [200, 'PERMIT', null, 'policy'],
    'uc42-search-blocked': [403, 'DENY', 'query_blocked', 'gateway'],
    'uc24-public': [200, 'PERMIT', null, 'policy'],
    'uc26-proof': [200, 'PERMIT', null, 'policy'],
    'uc27-bypass': [202, 'OBLIGATION', 'HITL_CONSENT', 'policy'],
  };
  const scenarios = rawStory().scenarios;
  assert.deepEqual(scenarios.map((sc) => sc.id), Object.keys(expected));
  await withServer(async (url) => {
    for (const sc of scenarios) {
      const s = session(url, `sc-${sc.id}`);
      if (Array.isArray(sc.flipTo)) await s.send('/api/directory/set', { user: sc.user, groups: sc.flipTo, tier: 'Standard' });
      // the attack-track scenarios ride the assistant turn (their seeding lives in the
      // shared scenario.js rule: wrong scope, raw token, outage); here the ORIGINAL
      // consent -> authorize -> receipt path keeps proving the non-attack scenarios
      if (sc.track === 'attacks' || sc.id === 'uc42-search-blocked' || sc.id === 'uc27-bypass') continue;
      // UC41 rides the plain authorize path with its query argument; the consent call names
      // the tool so the exchange narrows scope to the task (the UC4 rule /consent applies).
      const token = (await s.send('/api/consent', { user: sc.user, actor: sc.actor, tool: sc.tool, ...(sc.aud ? { aud: sc.aud } : {}) })).j.token;
      const r = await s.authorize(token, sc.tool, sc.amount, null, sc.query != null ? { query: sc.query } : {});
      assert.deepEqual([r.status, r.j.decision, r.j.code, r.j.stage], expected[sc.id], sc.id);
      if (r.j.decision !== 'OBLIGATION') continue;
      const answer = r.j.obligation === 'STEP_UP' ? MFA : r.j.obligation === 'CIBA' ? CIBA : CONSENT;
      const receipt = await s.receipt({ user: sc.user, tool: sc.tool, amount: sc.amount, answer });
      const done = await s.authorize(token, sc.tool, sc.amount, receipt);
      assert.equal(done.status, 200, `${sc.id} resolves with its receipt`);
      assert.equal(done.j.decision, 'PERMIT');
    }
  });
});

// ── the store itself ────────────────────────────────────────────────────────

test('the store is bounded: the oldest records are dropped past the cap, and a dropped receipt is not found', () => {
  const rs = createReceipts();
  const first = (() => {
    const ch = createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_transactions', amount: 300 });
    rs.track(ch);
    return answerChallenge({ receipts: rs, challenge: ch, answer: CONSENT }).receipt;
  })();
  const raise = () => {
    const ch = createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_transactions', amount: 300 });
    rs.track(ch);
    return ch;
  };
  for (let i = 0; i < STORE_MAX + 50; i += 1) answerChallenge({ receipts: rs, challenge: raise(), answer: CONSENT });
  for (let i = 0; i < STORE_MAX + 50; i += 1) raise(); // never answered
  const size = rs.size();
  assert.ok(size.challenges <= STORE_MAX && size.answered <= STORE_MAX && size.receipts <= STORE_MAX, JSON.stringify(size));
  const call = { receipt: first, user: 'demoUser', tool: 'get_transactions', obligation: 'CONFIRM', amount: 300 };
  assert.equal(rs.redeem(call).code, 'receipt_not_found', 'the oldest receipt was dropped');
});

test('records are dropped one TTL after they expire: expired first, then not found', () => {
  let now = 1_700_000_000_000;
  const rs = createReceipts({ now: () => now });
  const ch = createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_transactions', amount: 300, now: rs.now });
  rs.track(ch);
  const { receipt } = answerChallenge({ receipts: rs, challenge: ch, answer: CONSENT });
  const call = { receipt, user: 'demoUser', tool: 'get_transactions', obligation: 'CONFIRM', amount: 300 };
  now += (TTL_SECONDS + 1) * 1000;
  assert.equal(rs.redeem(call).code, 'receipt_expired');
  // a new record triggers the sweep; one more TTL on, the old receipt is gone
  now += TTL_SECONDS * 1000;
  rs.track(createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_balance', amount: 300, now: rs.now }));
  assert.equal(rs.redeem(call).code, 'receipt_not_found');
});

test('a receipt for another obligation is refused even when user, tool and amount match', () => {
  const rs = createReceipts();
  const ch = createChallenge({ obligation: 'CONFIRM', user: 'demoUser', tool: 'get_transactions', amount: 300 });
  rs.track(ch);
  const { receipt } = answerChallenge({ receipts: rs, challenge: ch, answer: CONSENT });
  const r = rs.redeem({ receipt, user: 'demoUser', tool: 'get_transactions', obligation: 'STEP_UP', amount: 300 });
  assert.equal(r.code, 'receipt_obligation_mismatch');
  assert.equal(rs.redeem({ receipt, user: 'demoUser', tool: 'get_transactions', obligation: 'CONFIRM', amount: 300 }).valid, true, 'and it was not burned');
});

test('with no store to verify against, a presented receipt is refused (fail closed)', () => {
  const token = exchange({ userSub: 'demoUser', actorClientId: 'demo-agent', scope: 'accounts:read' });
  const receipt = forge({ obligation: 'STEP_UP', tool: 'get_transactions', amount: 600, claims: { MfaVerified: true, ConsentGiven: true } });
  const r = decideWithObligation({ token, groups: ['privileged'], tier: 'Standard', tool: 'get_transactions', amount: 600, receipt });
  assert.equal(r.verdict.decision, 'OBLIGATION');
  assert.equal(r.receiptCheck.code, 'receipt_unverifiable');
});
