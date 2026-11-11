import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { mintWorkspaceToken, serverKey, workspaceTokenFingerprint } from '../src/workspaces.js';

const MFA = { consent: true, otp: '123123' };

// Session helper over the auth-off test server; a "session" = a distinct presenter secret.
// The test passes the presenter identity through the x-workspace-token header (the same
// header a real client carries), so the binding path is exercised end to end.
function session(url, ws, tokenHeader) {
  const h = { 'content-type': 'application/json', origin: url, 'x-workspace': ws, 'x-workspace-token': tokenHeader };
  return {
    async token() { return (await (await fetch(`${url}/api/consent`, { method: 'POST', headers: h, body: JSON.stringify({ user: 'demoUser', actor: 'demo-agent' }) })).json()).token; },
    async authorize(body) { const r = await fetch(`${url}/api/authorize`, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) } },
    async challenge(body) { const r = await fetch(`${url}/api/challenge`, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) } },
    async answer(challenge, answer) { const r = await fetch(`${url}/api/challenge/answer`, { method: 'POST', headers: h, body: JSON.stringify({ challenge, answer }) }); return r.json() },
    async receipt({ tool, amount }) {
      const token = await this.token();
      const a = await this.authorize({ token, tool, ucId: 'UC7', amount });
      const ch = await this.challenge({ user: 'demoUser', actor: 'demo-agent', tool, obligation: a.obligation, amount, token });
      return this.answer(ch.challenge, MFA);
    },
  };
}

test('a genuine receipt captured by a different session is refused: presenter binding', async () => {
  await withServer(async (url) => {
    const victim = session(url, 'w-bind', 'victim-session-token');
    const attacker = session(url, 'w-bind', 'attacker-session-token');
    const token = await victim.token();
    const a = await victim.authorize({ token, tool: 'get_transactions', ucId: 'UC7', amount: 600 });
    assert.equal(a.decision, 'OBLIGATION');
    const ch = await victim.challenge({ user: 'demoUser', actor: 'demo-agent', tool: 'get_transactions', obligation: a.obligation, amount: 600, token });
    const ans = await victim.answer(ch.challenge, MFA);
    assert.ok(ans.receipt?.sig, 'the victim got a signed receipt');
    // the attacker replays the captured receipt (same workspace, same user, same amount)
    const tokenA = await attacker.token();
    const stolen = await attacker.authorize({ token: tokenA, tool: 'get_transactions', ucId: 'UC7', amount: 600, receipt: ans.receipt });
    assert.equal(stolen.decision, 'OBLIGATION', 'the stolen receipt does not permit');
    assert.equal(stolen.receiptCheck?.code, 'receipt_presenter_mismatch');
    assert.match(stolen.receiptCheck?.reason || '', /different session/);
    // the victim can still use it
    const ok = await victim.authorize({ token, tool: 'get_transactions', ucId: 'UC7', amount: 600, receipt: ans.receipt });
    assert.equal(ok.decision, 'PERMIT', 'the legitimate presenter still permits');
  });
});
