// Rule 27: this lab's side of the shared run-observability panel. The vendored collector (runObservability.js) is never edited here;
// this is the one file that maps this lab's decisions onto the six layers. This lab reads no logs, so it vendors the core only: no
// readers file and no reader setting anywhere.
//
// What a run is here. ONE recorded action: the mock engine already writes one entry to the workspace's run log on every authorize,
// challenge, receipt, directory flip, consent mint, A2A exchange/tool call, attack run, NHI lifecycle step, assistant tool call and
// scenario step (app.js calls workspaces.record). That entry IS the run: one action, computed once, with its own decision. The
// observability record is built from that entry plus the token the action minted or inspected — nothing is re-run and nothing is
// computed twice.
//
// Which layer holds what. The PDP's verdict is the Authorize layer: PERMIT allowed, OBLIGATION info (a pause for a human, not a
// verdict on the call), DENY refused. A token mint (consent, A2A exchanges) is an allowed Privilege-layer row (the exchange granted
// a token). The gateway's relay and the resource server's tool execution are not modelled here as separate products: the lab is the
// mock of all of them, and the audit entry names the one decision the action came to, so no row invents a second decision. NHI
// lifecycle steps (JOINER/MOVER/LEAVER) are information in the Agent layer: the agent's own identity changed, no tool was served.
//
// Stdout line: `<iso> ai-demo-standalone-lab decision step=<step> layer=<layer> actor=<who> result=passed|stopped|unclear run=<id>`,
// one per action, stamped once. Every value passes the masker and the line sanitiser; no field names a matcher word.
import crypto from 'node:crypto';
import { createMasker, createRunObservability, LAYERS } from './runObservability.js';

export const SERVICE = 'ai-demo-standalone-lab';
export const KEEP_RUNS = 24; // closed runs kept per workspace and per mode (createRunLog); the panel shows the last few
export const NO_RUN_BEGAN = 'This request began no run, so nothing was recorded.';
export const RECORDER_DOWN = 'The lab could not keep a record of this run (the server log says why).';
export const NO_LONGER_KEPT = 'That run is no longer kept: the lab keeps the last few runs of each workspace, and Reset clears this workspace\'s runs.';

// Only safe characters survive, so a typed name cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
const MATCHER_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient/gi;
const { mask } = createMasker();
const field = (v) => lineValue(mask(String(v ?? ''))).replace(MATCHER_WORDS, '_');
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };

// A recorder that throws must never break the run or the answer: the failure goes to stderr and the run goes on. Only a code (or the
// error's name) is written, never the error's text.
export function reportFailure(where, err) {
  process.stderr.write(`[${SERVICE}] run observability: ${lineValue(where, 40)} ${lineValue(err?.code || err?.name || 'error', 40)} (the error's text is not logged)\n`);
}
export function safely(where, fn) {
  try { return fn(); } catch (err) { reportFailure(where, err); return undefined; }
}

const PRODUCT = { person: 'lab mock', agent: 'lab mock agent identity', privilege: 'lab mock token exchange', authorize: 'lab mock PDP', gateway: 'lab mock gateway', resource: 'lab mock resource server' };

// The step name for an action: the tool/action name the engine already logged, made line-safe (no dots).
const stepOf = (tool) => lineValue(String(tool ?? 'action'), 48).split('.').join('_') || 'action';

// DECISION -> (layer, outcome). The audit entry's decision word is the lab's own vocabulary (see the Observability page).
const MAP = {
  PERMIT: ['authorize', 'allowed'],
  DENY: ['authorize', 'refused'],
  OBLIGATION: ['authorize', 'info'],
  CHALLENGED: ['authorize', 'info'],
  RECEIPT: ['authorize', 'allowed'],
  MINTED: ['privilege', 'allowed'],
  NARROWED: ['resource', 'allowed'],
  BLOCKED: ['resource', 'refused'],
  FLIPPED: ['authorize', 'info'],
  JOINER: ['agent', 'info'],
  MOVER: ['agent', 'info'],
  LEAVER: ['agent', 'info'],
};

// The decisions one action left, from the audit entry and the token it minted or inspected. `entry` is what workspaces.record received
// ({ tool, decision, reason, token, blocked, ucId }); `extra` carries what the route knows that the entry does not (the acting subject
// and actor from the token, the amount, the use-case id).
export function actionEvents(entry, extra = {}) {
  if (!entry || typeof entry !== 'object' || typeof entry.decision !== 'string') return [];
  const [layer, outcome] = MAP[entry.decision] ?? ['authorize', 'info'];
  const token = entry.token && typeof entry.token === 'object' ? entry.token : null;
  const user = extra.user ?? token?.sub ?? null;
  const agent = extra.agent ?? token?.act?.sub ?? null;
  const scopes = Array.isArray(token?.scope) ? token.scope : typeof token?.scope === 'string' ? token.scope.split(/[\s]+/).filter(Boolean).slice(0, 20) : [];
  // The chain's keys (SPEC-chain-view-2026-11-24), only where a decision row already shows the fact: the person the token names, the
  // agent acting for them, the token's scope claim. The policy node: this lab's one policy decision is the PDP verdict on an
  // authorize action; a mint or a lifecycle step carries none.
  const chain = {
    ...(user ? { user } : {}),
    ...(agent ? { agent } : {}),
    ...(scopes.length ? { scopes } : {}),
    ...(layer === 'authorize' && ['PERMIT', 'DENY', 'OBLIGATION'].includes(entry.decision)
      ? { policy: { product: PRODUCT.authorize, decision: entry.decision === 'PERMIT' ? 'permit' : entry.decision === 'DENY' ? 'deny' : 'obligation', ...(entry.ucId ? { id: entry.ucId } : {}) } }
      : {}),
  };
  const detail = {
    step: stepOf(entry.tool),
    ...(entry.blocked ? { code: entry.blocked } : {}),
    ...(extra.amount != null ? { amount: extra.amount } : {}),
    ...chain,
  };
  return [{
    layer, product: PRODUCT[layer], step: stepOf(entry.tool), outcome, who: agent ?? user ?? 'the application',
    message: String(entry.reason ?? `${entry.tool}: ${entry.decision}`), detail,
  }];
}

// ---- Stdout lines ------------------------------------------------------------------------------------------------------------------------------------
export function decisionLine(ev, runId) {
  return `${ev.at} ${SERVICE} decision step=${lineValue(ev.step)} layer=${lineValue(ev.layer, 12)} actor=${field(ev.who)} result=${RESULT[ev.outcome] ?? 'unclear'} run=${lineValue(runId)}`;
}

// ---- The run log: bounded. Every run here is source 'mock' (the one Real exchange is recorded by the exchange panel, not here). --------
export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = Date.now } = {}) {
  const part = crypto.randomBytes(3).toString('hex'); // so an id never repeats after a restart or in another process
  let made = 0;
  const SOURCE = 'mock';
  // The cap is per workspace and per mode: one list of at most KEEP_RUNS runs for each (workspace, mode), so no workspace evicts another's.
  const kept = new Map(); // `${ws}` + NUL + mode -> that list, oldest first
  const keyOf = (ws, mode) => `${ws}\u0000${mode}`;
  const prune = (list) => { while (list.length > KEEP_RUNS) list.shift(); };
  const line = (ev, id) => safely('line', () => write(decisionLine(ev, id)));

  return {
    // One recorded action = one run, owned by its workspace. `build` may throw: then nothing is stored and the answer is the baseline's.
    mock(build, ws = null) {
      return safely('mock-run', () => {
        const events = build();
        const at = new Date(clock()).toISOString();
        const run = { id: `run-${part}-${++made}`, ws, source: SOURCE, startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false };
        const key = keyOf(ws, SOURCE);
        const list = kept.get(key) ?? [];
        list.push(run); prune(list); kept.set(key, list);
        for (const ev of run.events) line(ev, run.id);
        return run.id;
      }) ?? null;
    },
    // A run is answered only to the workspace that owns it; any other workspace gets null, the same as a run no longer kept.
    get(id, ws) { return (kept.get(keyOf(ws, SOURCE)) ?? []).find((r) => r.id === id) || null; },
    // Reset clears only the workspace's own runs (every mode); another workspace's kept runs stay.
    clear(ws) { for (const key of [...kept.keys()]) if (key.startsWith(`${ws}\u0000`)) kept.delete(key); },
    size() { let n = 0; for (const list of kept.values()) n += list.length; return n; },
  };
}
// The head key is `obs` (this lab's scenario answers already carry `run`: the teaching run object).
export const runField = (id) => (id ? { obs: { id } } : { obs: null, obsNote: RECORDER_DOWN });
export const NO_RUN = Object.freeze({ run: null, runNote: NO_RUN_BEGAN });

// ---- The record ----------------------------------------------------------------------------------------------------------------------------------------
const WHY = {
  person: 'The person step shows the subject the action\'s token names: the lab has no real sign-in.',
  agent: 'This action began no run (a read, a mode switch, a workspace mint): nothing was decided.',
  authorize: 'This action minted or relayed no policy verdict: it was a token mint, a lifecycle step or a narrow.',
  privilege: 'This action minted no token: the mock exchange was not called.',
  gateway: 'The lab models the gateway inline (the audit entry names the one decision), so no separate gateway decision exists.',
  resource: 'This action did not reach the mock resource server (a narrow is the resource answering: its row appears when it does).',
};

export async function recordOf(run, { clock = Date.now } = {}) {
  return createRunObservability({ clock }).collectRun({
    runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: run.source,
    layers: LAYERS.map((layer) => {
      const own = run.events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: { ...e.detail, eventSeq: e.seq } }));
      return { layer, products: [], reason: WHY[layer], simulated: own };
    }),
  });
}
