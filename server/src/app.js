// One Express app. /api = health, the use-case catalog, the mock PDP (/api/authorize),
// the seeded scenarios, the live directory board, info and reset. Directory state is per
// workspace id (X-Workspace). Loopback Host check and same-origin writes on everything.
// Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { hostedFrom, modeFrom, realAvailableFrom } from './config.js';
import { buildStory, CATALOG } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { decide, decideWithObligation, actChainDepth, DEFAULT_ACTORS, AUDIENCE, exchange } from './pdp.js';
import { DEFAULT_DIRECTORY, LIMITS } from './pdpData.js';
import { evaluateObligation, createChallenge, answerChallenge, createReceipts, HitlInputError } from './hitl.js';
import { exchangeOne, exchangeTwo, evaluateA2a, createRegistry, actChainDepth as a2aDepth, A2AInputError, agentCard as a2aAgentCard, LIMITS as A2A_LIMITS } from './a2a.js';
import { runAttack, createRateLimiter, ATTACK_CATALOG, AttackInputError } from './attacks.js';
import { mountShelfRoute } from './shelfLink.js';
import { explain, lessonFor, buildHops, newTrace, productCast } from './explain.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

// Per-workspace stores beside the directory: challenges + receipts (hitl.js), the A2A specialist registry.
const newExtra = () => ({ receipts: createReceipts(), registry: createRegistry({}), generalistToken: null });

export function createApp({
  health = createHealth(), configFile = CONFIG, hosted = false,
  workspaces = createWorkspaces({ makeDirectory: () => structuredClone(DEFAULT_DIRECTORY), makeExtra: () => ({ ...newExtra(), rateLimiter: createRateLimiter({ max: 8 }) }) }),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req), { hosted }), verticals: Object.keys(VERTICALS), hosted }); });
  // The full 87-UC catalog, filterable by track; the dashboard UI renders it grouped.
  api.get('/catalog', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const track = typeof req.query.track === 'string' && CATALOG.tracks ? CATALOG.tracks : null;
    let ucs = CATALOG.useCases;
    if (typeof req.query.track === 'string' && req.query.track) ucs = ucs.filter((u) => u.track === req.query.track);
    res.json({ schema: CATALOG.schema, tracks: [...new Set(CATALOG.useCases.map((u) => u.track))], verticals: CATALOG.verticals, count: ucs.length, useCases: ucs });
  });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: modeFrom(), source: modeFrom(), simulated: true, hosted, realAvailable: realAvailableFrom() }); });
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !realAvailableFrom()) {
      return res.status(409).json({ error: 'real_not_configured', detail: 'Real mode needs a live policy engine configuration (AIDEMOLAB_REAL_* env, owner-run). Mock keeps working.' });
    }
    return res.json({ source: body.source });
  });

  // The workspace's challenge/receipt store (created on first use if injected workspaces have none).
  const receiptsOf = (v) => {
    v.extra = v.extra || newExtra();
    v.extra.receipts = v.extra.receipts || createReceipts();
    return v.extra.receipts;
  };

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };

  // The live directory board: read on EVERY decision; per-workspace flips.
  api.get('/directory', withWorkspace((ws, _req, res) => {
    const v = workspaces.state(ws);
    res.json({ directory: v.directory || structuredClone(DEFAULT_DIRECTORY), workspace: ws });
  }));
  api.post('/directory/set', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.user !== 'string' || !body.user.trim()) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    const user = body.user.trim().slice(0, LIMITS.id);
    const v = workspaces.state(ws);
    const dir = v.directory || structuredClone(DEFAULT_DIRECTORY);
    if (body.groups !== undefined && !Array.isArray(body.groups)) return res.status(400).json({ error: 'bad_request', detail: 'body.groups must be an array of group names' });
    const groups = Array.isArray(body.groups) ? body.groups.filter((g) => typeof g === 'string').slice(0, 8).map((g) => String(g).trim().slice(0, LIMITS.group)) : [];
    const tier = body.tier === 'Premium' ? 'Premium' : 'Standard';
    dir[user] = { groups, tier };
    v.directory = dir;
    workspaces.record(ws, { tool: 'directory-set', decision: 'FLIPPED', reason: `${user} -> [ ${groups.join(', ') || 'no groups'} ], tier ${tier}`, token: null });
    return res.json({ user, groups, tier, directory: dir, workspace: ws });
  }));

  // Mint a delegated token (mock consent): sub = user, act = { actor }, 1h.
  api.post('/consent', withWorkspace((ws, req, res) => {
    const body = req.body || {};
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim().slice(0, LIMITS.id) : 'demoUser';
    if (typeof body.user === 'string' && !body.user.trim()) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    const actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim().slice(0, LIMITS.id) : DEFAULT_ACTORS[0];
    const aud = typeof body.aud === 'string' && body.aud.trim() ? body.aud.trim().slice(0, 100) : AUDIENCE;
    const token = exchange({ userSub: user, actorClientId: actor, aud });
    workspaces.record(ws, { tool: 'consent', decision: 'MINTED', reason: `act={${token.act.sub}} for ${token.sub}`, token: null });
    return res.json({ token, workspace: ws });
  }));

  // THE endpoint: one gated call — the same engine behind every catalog use case.
  // 401 (protocol) and 403 (gateway/policy) are DATA, not errors.
  api.post('/authorize', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.token == null) {
      return res.status(401)
        .set('WWW-Authenticate', `Bearer realm="${AUDIENCE}", error="invalid_request", error_description="Missing bearer token"`)
        .json({ decision: 'DENY', stage: 'protocol', code: 'missing_bearer', reason: 'No bearer token: the API answers 401 before anything else.', stages: ['protocol: 401'] });
    }
    const tool = typeof body.tool === 'string' && body.tool ? body.tool.slice(0, LIMITS.id) : 'get_balance';
    const amount = body.amount == null ? null : Number(body.amount);
    const v = workspaces.state(ws);
    const dir = v.directory || structuredClone(DEFAULT_DIRECTORY);
    const entry = dir[body.token.sub] || { groups: [], tier: 'Standard' };
    const ucId = typeof body.ucId === 'string' ? body.ucId.slice(0, 16) : null;
    // Stage 2: bands and HITL tools produce OBLIGATIONS, not denials — the agent pauses,
    // the human answers, and the receipt re-evaluates the same call. The receipt is checked
    // against this workspace's store (issued here, unspent, binds the call) and consumed.
    const claimed = typeof body.receipt === 'object' && body.receipt !== null ? body.receipt : null;
    const { verdict, obligation, receiptCheck } = decideWithObligation({
      token: body.token, groups: entry.groups, tier: entry.tier, tool, amount, receipt: claimed, receipts: receiptsOf(v),
      authorizedActors: Array.isArray(body.authorizedActors) ? body.authorizedActors.slice(0, 8).map((x) => String(x).slice(0, LIMITS.id)) : DEFAULT_ACTORS,
      audience: typeof body.aud === 'string' && body.aud.trim() ? body.aud.trim().slice(0, 100) : AUDIENCE,
      now: () => Date.now(),
    });
    workspaces.record(ws, { tool, decision: verdict.decision, reason: verdict.reason, token: body.token, blocked: verdict.code, ucId });
    const ctx = { user: body.token.sub, actor: body.token.act?.sub || null, tool, amount, groups: entry.groups, tier: entry.tier, aud: body.aud };
    const trace = newTrace(req.headers.traceparent);
    const status = verdict.decision === 'PERMIT' ? 200 : verdict.decision === 'OBLIGATION' ? 202 : 403;
    return res.status(status).json({
      ...verdict, tool, user: body.token.sub, act: body.token.act ?? null,
      chainDepth: actChainDepth(body.token.act), groups: entry.groups, tier: entry.tier,
      ucId, workspace: ws, obligation, amount: amount ?? null, receiptCheck,
      // the teaching layer
      narrative: explain(verdict, ctx),
      lesson: lessonFor(verdict, ctx),
      products: productCast(verdict),
      hops: buildHops({ verdict, ...ctx, token: body.token, trace, consent: true }),
      traceId: trace.traceId,
    });
  }));


  // ── Stage 2: HITL (UC7/UC8/UC22) ─────────────────────────────────────────────
  // The gated call returns an OBLIGATION instead of a decision when the bands hit.
  // The agent pauses; the human answers; a receipt re-evaluates the SAME call.
  api.post('/challenge', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    const tool = typeof body.tool === 'string' && body.tool ? body.tool.slice(0, LIMITS.id) : 'get_balance';
    const amount = body.amount == null ? null : Number(body.amount);
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim().slice(0, LIMITS.id) : null;
    if (!user) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    try {
      const ob = evaluateObligation({ tool, amount });
      if (!ob.obligation) return res.status(400).json({ error: 'no_challenge', detail: ob.reason });
      const receipts = receiptsOf(workspaces.state(ws));
      const ch = createChallenge({ obligation: ob.obligation, user, tool, amount, now: receipts.now });
      receipts.track(ch); // the server keeps the challenge; the answer is checked against this copy
      workspaces.record(ws, { tool, decision: 'CHALLENGED', reason: ob.reason, token: null, blocked: ob.obligation });
      return res.json({ challenge: ch, obligation: ob.obligation, reason: ob.reason, workspace: ws });
    } catch (e) {
      if (e instanceof HitlInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.post('/challenge/answer', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    try {
      const answered = answerChallenge({ receipts: receiptsOf(workspaces.state(ws)), challenge: body.challenge, answer: body.answer });
      if (!answered.ok) return res.status(400).json({ error: answered.code, detail: answered.reason });
      const { receipt } = answered;
      workspaces.record(ws, { tool: receipt.tool, decision: 'RECEIPT', reason: `receipt bound to ${receipt.obligation} for ${receipt.user}`, token: null });
      return res.json({ receipt, workspace: ws });
    } catch (e) {
      if (e instanceof HitlInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));

  // ── Stage 2: A2A (UC2/2.5/2.6/2.7) ──────────────────────────────────────────
  api.get('/a2a/agent-card', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(a2aAgentCard({ host: `agents.${castFor(req).castHost}.example` }));
  });
  api.post('/a2a/exchange/one', withWorkspace((ws, req, res) => {
    const body = req.body || {};
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim().slice(0, A2A_LIMITS.clientId) : null;
    if (!user) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    const generalist = typeof body.generalist === 'string' && body.generalist.trim() ? body.generalist.trim().slice(0, A2A_LIMITS.clientId) : 'generalist-agent';
    const scope = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim().slice(0, A2A_LIMITS.scope) : 'a2a:get_portfolio_summary';
    try {
      const token = exchangeOne({ userSub: user, generalistClientId: generalist, scope });
      const v = workspaces.state(ws);
      if (v.extra) v.extra.generalistToken = token;
      workspaces.record(ws, { tool: 'a2a-exchange-1', decision: 'MINTED', reason: `act={${token.act.sub}} for ${token.sub}`, token: null });
      return res.json({ token, workspace: ws });
    } catch (e) {
      if (e instanceof A2AInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.post('/a2a/exchange/two', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.generalistToken == null) return res.status(400).json({ error: 'token_required', detail: 'body.generalistToken (the exchange-#1 token) is required' });
    const specialist = typeof body.specialist === 'string' && body.specialist.trim() ? body.specialist.trim().slice(0, A2A_LIMITS.clientId) : 'portfolio-specialist';
    const scope = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim().slice(0, A2A_LIMITS.scope) : 'a2a:get_portfolio_summary';
    try {
      const token = exchangeTwo({ generalistToken: body.generalistToken, specialistClientId: specialist, scope });
      workspaces.record(ws, { tool: 'a2a-exchange-2', decision: 'MINTED', reason: `nested act {${token.act.sub} -> ${token.act.act.sub}} for ${token.sub}`, token: null });
      return res.json({ token, workspace: ws });
    } catch (e) {
      if (e instanceof A2AInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.post('/a2a/tool', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.token == null) {
      return res.status(401).set('WWW-Authenticate', 'Bearer realm="ai-demo-standalone", error="invalid_request"').json({ decision: 'DENY', stage: 'protocol', code: 'missing_bearer', reason: 'No bearer token: the A2A gateway answers 401 before anything else.' });
    }
    const v = workspaces.state(ws);
    const extra = v.extra || { registry: createRegistry({}) };
    const verdict = evaluateA2a({ token: body.token, registeredSpecialists: extra.registry.all(), requiredScope: 'a2a:get_portfolio_summary', now: () => Date.now(), upstreamAudiences: ['mcp-portfolio.internal'] });
    workspaces.record(ws, { tool: 'a2a-tool', decision: verdict.decision, reason: verdict.reason, token: body.token, blocked: verdict.code });
    return res.status(verdict.decision === 'PERMIT' ? 200 : 403).json({ ...verdict, chainDepth: a2aDepth(body.token.act), registered: extra.registry.all(), workspace: ws });
  }));
  api.get('/a2a/registry', withWorkspace((ws, _req, res) => {
    const v = workspaces.state(ws);
    const extra = v.extra || { registry: createRegistry({}) };
    res.json({ specialists: extra.registry.all(), workspace: ws });
  }));
  api.post('/a2a/registry/set', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.specialist !== 'string' || !body.specialist.trim()) return res.status(400).json({ error: 'name_required', detail: 'body.specialist must be non-empty text' });
    if (typeof body.registered !== 'boolean') return res.status(400).json({ error: 'bad_request', detail: 'body.registered must be a boolean' });
    const v = workspaces.state(ws);
    const extra = v.extra || { registry: createRegistry({}) };
    const all = extra.registry.set(body.specialist.trim().slice(0, A2A_LIMITS.name), body.registered);
    v.extra = extra;
    workspaces.record(ws, { tool: 'a2a-registry-set', decision: 'FLIPPED', reason: `${body.specialist.trim()} -> ${body.registered ? 'registered' : 'revoked'}`, token: null });
    return res.json({ specialist: body.specialist.trim(), registered: body.registered, specialists: all, workspace: ws });
  }));


  // ── Stage 3: the attack gallery (UC4/5/10-18) ───────────────────────────────
  api.get('/attacks', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ attacks: ATTACK_CATALOG, workspace: null }); });
  api.post('/attacks/run', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.attackId !== 'string' || !body.attackId.trim()) return res.status(400).json({ error: 'attack_required', detail: 'body.attackId must be non-empty text' });
    const v = workspaces.state(ws);
    const extra = v.extra || { rateLimiter: createRateLimiter({ max: 8 }) };
    const entry = (v.directory || structuredClone(DEFAULT_DIRECTORY))['demoUser'] || { groups: [], tier: 'Standard' };
    try {
      const result = runAttack(body.attackId.trim().slice(0, 40), { user: 'demoUser', groups: entry.groups, tier: entry.tier, rateLimiter: extra.rateLimiter });
      v.extra = extra;
      workspaces.record(ws, { tool: `attack:${result.attackId}`, decision: result.got.status === 200 ? 'NARROWED' : 'BLOCKED', reason: result.lesson, token: null, blocked: result.got.code });
      return res.json({ ...result, workspace: ws });
    } catch (e) {
      if (e instanceof AttackInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  api.post('/reset', withWorkspace((ws, _req, res) => {
    workspaces.resetWorkspace(ws);
    res.json({ reset: 'ok', workspace: ws });
  }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  mountShelfRoute(app);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    console.error('internal_error:', err?.message, err?.stack?.split('\n')[1]);
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
