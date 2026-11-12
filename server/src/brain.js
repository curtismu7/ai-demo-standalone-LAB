// P2b: the LangGraph brain (opt-in, off by default). When AIDEMO_BRAIN_URL is set the
// assistant turn can be planned by a local model through the brain sidecar; every tool
// call the model chooses is executed HERE, by the same engine path the Scripted brain
// uses (decideWithObligation — the group gate, tier bands and HITL obligations apply to
// a model-driven call exactly as to a scripted one). With the URL unset nothing changes:
// createBrain returns the Scripted matcher and no model call is ever made.
import { randomBytes } from 'node:crypto';
import { SCENARIOS, TOOLS } from './policyData.js';
import { seedFor, tokenFor, callArgsFor } from './scenario.js';
import { explain, lessonFor, buildHops, productCast } from './explain.js';
import { buildDemoHops, buildTokenCards } from './hops.js';
import { DEFAULT_DIRECTORY } from './pdpData.js';
import { DEFAULT_ACTORS, AUDIENCE } from './pdp.js';

// ── the shared secret for the sidecar's tool calls and /run calls ────────────
// Per boot: the sidecar and the lab are the same compose project, so the secret
// is handed to both through the environment (compose interpolates one value into
// both containers). A sidecar call without the exact secret is refused.
export function brainSecret(env = process.env) {
  if (env.AIDEMOLAB_BRAIN_SECRET && env.AIDEMOLAB_BRAIN_SECRET.length >= 16) return env.AIDEMOLAB_BRAIN_SECRET;
  return null; // no secret configured -> the tool route and /run-with-brain stay closed
}

export function brainConfigured(env = process.env) {
  return Boolean(env.AIDEMO_BRAIN_URL) && Boolean(brainSecret(env));
}

// ── the tool list the sidecar sees (name, description, inputSchema) ──────────
// Built from this lab's TOOLS + the argument shapes the engine actually reads.
const TOOL_SCHEMA_ARG_SHAPES = {
  get_balance: { user: { type: 'string', description: 'the customer id' } },
  get_transactions: { user: { type: 'string', description: 'the customer id' } },
  show_mortgage: { user: { type: 'string', description: 'the customer id' } },
  create_wire_transfer: {
    user: { type: 'string', description: 'the customer id' },
    amount: { type: 'number', description: 'the amount in dollars' },
  },
  brave_news_search: { query: { type: 'string', description: 'the search query' } },
  get_branch_hours: { branch: { type: 'string', description: 'the branch name' } },
};

export function toolSchemas() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: `${t.lesson} (${t.kind} action)`,
    inputSchema: { type: 'object', properties: TOOL_SCHEMA_ARG_SHAPES[t.name] || {}, required: Object.keys(TOOL_SCHEMA_ARG_SHAPES[t.name] || {}) },
  }));
}

// ── executing one model-chosen tool call through the engine ──────────────────
// The sidecar POSTs {tool, args, sessionId, runId} here with the shared secret.
// The workspace (session) must already exist — the sidecar never mints tokens.
export function createToolRoute({ workspaces, receiptsOf }) {
  return async function handleToolCall(req, res) {
    const ws = req.params.workspace;
    const body = req.body;
    if (typeof body?.tool !== 'string' || typeof body?.args !== 'object' || body.args === null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const v = workspaces.state(ws);
    const dir = v.directory || structuredClone(DEFAULT_DIRECTORY);
    const [user] = Object.keys(dir);
    const entry = dir[user] || structuredClone(DEFAULT_DIRECTORY.demoUser);
    const tool = body.tool;
    const args = body.args;
    const amount = Number.isFinite(Number(args.amount)) ? Number(args.amount) : null;
    const token = tokenFor({ user, actor: 'airline_agent', tool });
    const { verdict, obligation } = decideWithObligation({
      token, groups: entry.groups, tier: entry.tier, tool, amount,
      resourceOwner: user, query: String(args.query ?? ''), consentGiven: false,
      receipts: receiptsOf(v), authorizedActors: DEFAULT_ACTORS, audience: AUDIENCE, now: () => Date.now(),
    });
    workspaces.record(ws, { tool, decision: verdict.decision, reason: verdict.reason, token, blocked: verdict.code, ucId: 'brain-tool' });
    const result = verdict.decision === 'PERMIT'
      ? { result: 'PERMIT', tool, amount }
      : { result: verdict.decision, code: verdict.code, reason: verdict.reason, obligation: obligation ?? undefined };
    return res.json({ result, hops: [] });
  };
}

// ── the fold: sidecar AG-UI SSE -> the /api/assistant/turn JSON ─────────────
// Reads the sidecar's POST /run stream, collects text/tool events, and folds them into
// the SAME shape the Scripted turn returns. The engine run (verdict, hops, tokens) is
// the workspace's LAST recorded tool run — the model's tool calls went through
// /api/assistant/tool, which recorded each one — so the evidence views render the real
// engine output, never a model-invented story. Returns null when the sidecar produced
// nothing usable (the caller falls back to Scripted).
export function createBrainTurn({ fetchImpl = fetch, env = process.env } = {}) {
  return async function brainTurn({ message, ws, workspaces, receiptsOf }) {
    const secret = brainSecret(env);
    const base = String(env.AIDEMOLAB_TOOL_URL || 'http://127.0.0.1:7810').replace(/\/api\/assistant\/tool$/, '');
    const url = `${base || 'http://127.0.0.1:7810'}/run`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(env.AIDEMO_BRAIN_TURN_TIMEOUT_MS || 120_000));
    let text = '';
    let toolName = null;
    let usage = null;
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-brain-secret': secret },
        body: JSON.stringify({ message, threadId: ws, runId: `turn_${ws}_${Date.now()}`, tools: toolSchemas() }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) return null;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const line of buf.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          buf = buf.slice(buf.indexOf(line) + line.length + 1);
          let e; try { e = JSON.parse(line.slice(6)); } catch { continue; }
          if (e.type === 'TEXT_MESSAGE_CONTENT') text += e.delta || '';
          else if (e.type === 'TOOL_CALL_START') toolName = e.toolCallName || toolName;
          else if (e.type === 'CUSTOM' && e.name === 'token_usage') usage = e.value || null;
          else if (e.type === 'RUN_ERROR') return null; // sidecar failed: fall back
        }
      }
    } catch {
      return null; // unreachable sidecar: fall back to Scripted
    } finally {
      clearTimeout(timer);
    }
    text = text.trim();
    if (!text && !toolName) return null;
    const v = workspaces.state(ws);
    const last = (workspaces.runs(ws).runs ?? [])[0] ?? null;
    return {
      handling: 'in-app', ucId: last?.ucId ?? 'brain-tool', scenarioId: null,
      decision: last?.decision ?? null, say: last?.reason ?? text, run: null,
      hops: [], demoHops: [], tokens10: [],
      reply: { text: text || `Ran ${toolName ?? 'the tool'}.`, by: 'agent', outcome: last?.decision ?? 'RAN', ucId: last?.ucId ?? null, tool: toolName ?? last?.tool ?? null, brain: 'langgraph' },
    };
  };
}
