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
import { modeFrom, realAvailableFrom } from './config.js';
import { realExchange, realExchangeConfigured, NO_REAL_EXCHANGE } from './realExchange.js';
import { buildStory, CATALOG } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { decide, decideWithObligation, actChainDepth, DEFAULT_ACTORS, AUDIENCE, exchange, TOOL_REQUIRED_SCOPE } from './pdp.js';
import { DEFAULT_DIRECTORY, LIMITS } from './pdpData.js';
import { evaluateObligation, createChallenge, answerChallenge, createReceipts, HitlInputError } from './hitl.js';
import { exchangeOne, exchangeTwo, evaluateA2a, createRegistry, actChainDepth as a2aDepth, A2AInputError, agentCard as a2aAgentCard, LIMITS as A2A_LIMITS } from './a2a.js';
import { runAttack, createRateLimiter, ATTACK_CATALOG, AttackInputError } from './attacks.js';
import { createRoster, keyAllows, KNOWN_SCOPES, NhiInputError } from './nhi.js';
import { mountShelfRoute, shelfInfo } from './shelfLink.js';
import { explain, lessonFor, buildHops, newTrace, productCast } from './explain.js';
import { matchTurn } from './assistant.js';
import { createWorkspaces, workspaceFrom, serverKey, mintWorkspaceToken, verifyWorkspaceToken, workspaceTokenFingerprint } from './workspaces.js';
import { createBookings } from './bookings.js';
import { createRealSignin, RealRefused } from './realSignin.js';
import { signinConfig } from './realSignin.js';
import { SCENARIOS } from './policyData.js';
import { seedFor, tokenFor, callArgsFor } from './scenario.js';
import { toDemoHops, tokenCardsFrom } from './evidenceAdapter.js';
import { buildDemoHops, buildTokenCards } from './hops.js';
import { usecaseRows, usecaseEntries, handoffHref } from './usecases.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

// Per-workspace stores beside the directory: challenges + receipts (hitl.js), the A2A specialist registry.
const newExtra = () => ({ receipts: createReceipts(), registry: createRegistry({}), generalistToken: null, bookings: createBookings() });

export function createApp({
  health = createHealth(), configFile = CONFIG,
  workspaces,
  // Workspace auth: ON by default. Tests pass workspaceAuth: false to address workspaces directly.
  workspaceAuth = true,
  wsKey = serverKey(process.env),
  // Durable stores: set stateDir (AIDEMOLAB_STATE_DIR) to persist each workspace to disk.
  stateDir = process.env.AIDEMOLAB_STATE_DIR || null,
  // P10 Real sign-in (owner-run). env is the settings source (tests inject a fake); signin is the createRealSignin
  // override for tests. With no valid configuration the sign-in is simply unavailable (GET /api/signin) and the
  // Real toggle keeps its rule-19 409.
  env = process.env,
  signin,
} = {}) {
  const hydrateExtra = (extra, snap) => {
    extra.receipts = createReceipts({ initial: snap.receipts, signingKey: snap.receipts?.signingKey ?? undefined });
    extra.registry = createRegistry({ initial: snap.registry });
    extra.roster = createRoster({ initial: snap.roster });
    return extra;
  };
  workspaces = workspaces ?? createWorkspaces({
    makeDirectory: () => structuredClone(DEFAULT_DIRECTORY), stateDir, hydrateExtra,
    makeExtra: () => ({ ...newExtra(), rateLimiter: createRateLimiter({ max: 8 }), roster: createRoster() }),
  });
  const realSignin = signin ?? createRealSignin({ config: signinConfig(env, env) });
  const signinSettingsComplete = Boolean(env.AIDEMOLAB_SIGNIN_CLIENT_ID && env.AIDEMOLAB_SIGNIN_CLIENT_SECRET && (env.PINGONE_ENVIRONMENT_ID || env.AIDEMOLAB_SIGNIN_BASE_URL));

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
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req)), verticals: Object.keys(VERTICALS) }); });
  // The full 87-UC catalog, filterable by track; the dashboard UI renders it grouped.
  api.get('/catalog', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const track = typeof req.query.track === 'string' && CATALOG.tracks ? CATALOG.tracks : null;
    let ucs = CATALOG.useCases;
    if (typeof req.query.track === 'string' && req.query.track) ucs = ucs.filter((u) => u.track === req.query.track);
    res.json({ schema: CATALOG.schema, tracks: [...new Set(CATALOG.useCases.map((u) => u.track))], verticals: CATALOG.verticals, count: ucs.length, useCases: ucs });
  });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); let version = null; try { version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || null; } catch { /* no version */ } res.json({ mode: modeFrom(), source: modeFrom(), simulated: true, realAvailable: realAvailableFrom(), version }); });
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

  // Real PingOne token exchange (RFC 8693, third-party JWT as the actor token). Owner-configured via
  // AIDEMOLAB_REAL_*; the netguard allowlist covers exactly its endpoint hosts. Secret write-only; tokens hashed.
  api.post('/real-exchange', async (req, res) => {
    if (!realExchangeConfigured()) return res.status(409).json({ error: 'real_not_configured', detail: NO_REAL_EXCHANGE });
    const r = await realExchange(req.body);
    if (!r.ok) return res.status(r.status).json({ error: r.error, detail: r.errorDescription });
    return res.json({ source: 'real', ...r });
  });

  // The workspace's challenge/receipt store (created on first use if injected workspaces have none).
  const receiptsOf = (v) => {
    v.extra = v.extra || newExtra();
    v.extra.receipts = v.extra.receipts || createReceipts();
    return v.extra.receipts;
  };

  // The per-workspace booking system (created on first use; injected workspaces may lack it).
  const bookingsOf = (v) => {
    v.extra = v.extra || newExtra();
    v.extra.bookings = v.extra.bookings || createBookings();
    return v.extra.bookings;
  };

  // Presenter identity: the caller's own session nonce (random per browser tab, NOT a
  // server-issued credential), fingerprinted with the server key so the stored value can't
  // be forged or replayed. A receipt is redeemable only by the session that raised its
  // challenge — a receipt captured by another tab/session fails the match.
  const presenterOf = (req) => workspaceTokenFingerprint(workspaceFrom(req), req.headers['x-session-nonce'], wsKey);

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    // A workspace id is not a credential: the request must carry the HMAC token this
    // server minted for THAT id (GET /api/workspace). A forged or mismatched pair is 401.
    if (workspaceAuth && !verifyWorkspaceToken(ws, req.headers['x-workspace-token'], wsKey)) {
      return res.status(401).json({ error: 'workspace_token_required', detail: 'mint a workspace token first: GET /api/workspace' });
    }
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };

  // Mint a workspace token. The id may be client-chosen (rule 13) but the token is ours.
  api.get('/workspace', (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    res.json({ workspace: ws, token: mintWorkspaceToken(ws, wsKey) });
  });

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
    // The exchange narrows scope to the task (UC4): consent with a tool mints the task's
    // required scope; consent without one mints the consented grant (read + write).
    const tool = typeof body.tool === 'string' && body.tool.trim() ? body.tool.trim().slice(0, LIMITS.id) : null;
    let scope = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim().slice(0, 100)
      : tool ? TOOL_REQUIRED_SCOPE[tool] ?? 'accounts:read' : 'accounts:read transfers:write';
    const token = exchange({ userSub: user, actorClientId: actor, aud, scope });
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
    // Reviewer item 10: a `receipt` that is present but not an object is a bad request,
    // not a silent "no receipt" (that would let a malformed receipt slip through as none).
    if ('receipt' in body && body.receipt !== null && (typeof body.receipt !== 'object' || Array.isArray(body.receipt))) {
      return res.status(400).json({ error: 'bad_receipt', detail: 'body.receipt, when present, must be the receipt object the challenge/answer call returned' });
    }
    const claimed = typeof body.receipt === 'object' && body.receipt !== null ? body.receipt : null;
    const { verdict, obligation, receiptCheck } = decideWithObligation({
      token: body.token, groups: entry.groups, tier: entry.tier, tool, amount, receipt: claimed, receipts: receiptsOf(v), presenter: presenterOf(req),
      resourceOwner: typeof body.resourceOwner === 'string' && body.resourceOwner.trim() ? body.resourceOwner.trim().slice(0, LIMITS.id) : null,
      // UC41/UC42: the gateway inspects the search query argument; UC27: a client-sent
      // "consent already given" flag is passed in only so the engine can answer it (ignored).
      query: typeof body.query === 'string' && body.query.trim() ? body.query.trim().slice(0, 300) : null,
      consentGiven: body.consentGiven === true ? true : null,
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
      hops: toDemoHops(buildHops({ verdict, ...ctx, token: body.token, trace, consent: true }), { decision: verdict.decision }),
      tokens: tokenCardsFrom({ exchangeToken: body.token }),
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
    // Reviewer item 6: the amount is validated before it reaches the engine (a negative,
    // NaN or non-numeric amount is a bad request, never a 200 with a challenge).
    const amount = body.amount == null ? null : Number(body.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({ error: 'bad_amount', detail: 'body.amount must be a non-negative number' });
    }
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim().slice(0, LIMITS.id) : null;
    if (!user) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    try {
      // Reviewer item 2: run the POLICY before raising the challenge, so a call the policy
      // denies (group gate, tier ceiling, premium-only tool) never gets an MFA/consent
      // prompt for a call that will refuse the receipt anyway. The challenge needs the same
      // token context /authorize uses; a synthetic one is built from the workspace directory.
      const v = workspaces.state(ws);
      const dir = v.directory || structuredClone(DEFAULT_DIRECTORY);
      const entry = dir[user] || { groups: [], tier: 'Standard' };
      const verdict = decide({
        // A synthetic token in the exact shape /consent mints (the policy reads the directory
        // by `sub`; the chain check needs a valid act + aud + future exp). The actor is the
        // body's actor (the one the agent actually uses) or the allow-list's first entry.
        token: {
          sub: user, act: { sub: typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim().slice(0, LIMITS.id) : DEFAULT_ACTORS[0] },
          // the synthetic token carries the task's required scope (the exchange narrows to
          // the task, UC4); the challenge must pass the same gateway stages /authorize runs
          scope: TOOL_REQUIRED_SCOPE[tool] ?? 'accounts:read', aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300,
        },
        groups: entry.groups, tier: entry.tier,
        tool, amount, authorizedActors: DEFAULT_ACTORS, audience: AUDIENCE, now: () => Date.now(),
      });
      if (verdict.decision !== 'PERMIT') {
        return res.status(403).json({ decision: 'DENY', stage: verdict.stage, code: verdict.code, reason: verdict.reason, detail: 'the policy denies this call; a challenge would not change the outcome' });
      }
      const ob = evaluateObligation({ tool, amount });
      if (!ob.obligation) return res.status(400).json({ error: 'no_challenge', detail: ob.reason });
      const receipts = receiptsOf(workspaces.state(ws));
      const ch = createChallenge({ obligation: ob.obligation, user, tool, amount, now: receipts.now, presenter: presenterOf(req) });
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


  // ── Stage 4: NHI (UC-NHI1/UC-NHI2) — the agent's own identity, live lifecycle ──
  api.get('/nhi/roster', withWorkspace((ws, _req, res) => {
    const v = workspaces.state(ws);
    const roster = v.extra?.roster || createRoster();
    res.json({ agents: roster.all(), knownScopes: KNOWN_SCOPES, workspace: ws });
  }));
  api.post('/nhi/register', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.agentId !== 'string' || !body.agentId.trim()) return res.status(400).json({ error: 'agent_required', detail: 'body.agentId must be non-empty text' });
    if (!Array.isArray(body.scopes) || !body.scopes.length) return res.status(400).json({ error: 'scopes_required', detail: `body.scopes must be a non-empty array of known scopes: ${KNOWN_SCOPES.join(', ')}` });
    const v = workspaces.state(ws);
    const roster = v.extra?.roster || createRoster();
    try {
      const a = roster.register(body.agentId.trim().slice(0, 64), body.scopes);
      v.extra = v.extra || {}; v.extra.roster = roster;
      workspaces.record(ws, { tool: 'nhi-register', decision: 'JOINER', reason: `${a.agentId} registered with scopes [ ${a.scopes.join(', ')} ]`, token: null });
      return res.json({ agent: { agentId: a.agentId, keyId: a.keyId, keyPrefix: a.keyPrefix, scopes: a.scopes, status: a.status }, workspace: ws });
    } catch (e) {
      if (e instanceof NhiInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.post('/nhi/rotate', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (typeof body?.agentId !== 'string' || !body.agentId.trim()) return res.status(400).json({ error: 'agent_required' });
    const v = workspaces.state(ws);
    const roster = v.extra?.roster || createRoster();
    try {
      const a = roster.rotate(body.agentId.trim().slice(0, 64));
      workspaces.record(ws, { tool: 'nhi-rotate', decision: 'MOVER', reason: `${a.agentId} key rotated -> ${a.keyId}`, token: null });
      return res.json({ agent: { agentId: a.agentId, keyId: a.keyId, keyPrefix: a.keyPrefix, status: a.status }, workspace: ws });
    } catch (e) {
      if (e instanceof NhiInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.post('/nhi/revoke', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (typeof body?.agentId !== 'string' || !body.agentId.trim()) return res.status(400).json({ error: 'agent_required' });
    const v = workspaces.state(ws);
    const roster = v.extra?.roster || createRoster();
    try {
      const a = roster.revoke(body.agentId.trim().slice(0, 64));
      workspaces.record(ws, { tool: 'nhi-revoke', decision: 'LEAVER', reason: `${a.agentId} revoked — every platform loses access immediately`, token: null });
      return res.json({ agent: { agentId: a.agentId, keyId: a.keyId, status: a.status }, workspace: ws });
    } catch (e) {
      if (e instanceof NhiInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  api.get('/nhi/jml', withWorkspace((ws, _req, res) => {
    const v = workspaces.state(ws);
    const roster = v.extra?.roster || createRoster();
    res.json({ events: roster.jml.all(), workspace: ws });
  }));

  // ── P2: the one-page dashboard's assistant turn. The Scripted brain matches ONE prompt to
  // ONE handling: an in-app scenario (run through the SAME engine as /api/authorize, seeded
  // exactly the way the scenario states, recorded in the workspace), a redirect to a
  // standalone lab (a shelf folder name — the UI resolves the card), or an honest unknown.
  // The reply is always written from the run, never by the matcher.
  api.post('/assistant/turn', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.message !== 'string' || !body.message.trim()) return res.status(400).json({ error: 'message_required', detail: 'body.message must be non-empty text (<= 500 chars)' });
    const turn = matchTurn(body.message.slice(0, 500));
    if (turn.handling === 'unknown') {
      return res.json({ handling: 'unknown', reply: { text: 'I could not match that to a scripted demo. Try one of the suggestion chips, or open Use Cases.', by: 'agent', outcome: 'UNKNOWN' } });
    }
    if (turn.handling === 'redirect') {
      return res.json({
        handling: 'redirect', ucId: turn.ucId, lab: turn.lab,
        reply: { text: `That story lives in its own lab: ${turn.lab}. Open it from the shelf.`, by: 'agent', outcome: 'HANDOFF', ucId: turn.ucId, tool: null },
      });
    }
    // in-app: the SCENARIOS re-check (a drifted or invented id can never reach the engine)
    const sc = SCENARIOS.find((s) => s.id === turn.scenarioId);
    if (!sc) return res.json({ handling: 'unknown', reply: { text: 'I could not match that to a scripted demo. Try one of the suggestion chips, or open Use Cases.', by: 'agent', outcome: 'UNKNOWN' } });
    const amount = turn.amount ?? sc.amount;
    const v = workspaces.state(ws);
    const dir = v.directory || structuredClone(DEFAULT_DIRECTORY);
    // seed the directory the way the scenario states — the SHARED seeding rule (scenario.js),
    // the same one the doctor and the tests apply, so a scenario cannot be seeded differently
    // by the endpoint and by a test.
    const entry = seedFor(sc);
    dir[sc.user] = entry;
    v.directory = dir;
    const token = tokenFor(sc);
    const callArgs = callArgsFor(sc);
    const { verdict, obligation } = decideWithObligation({
      token, groups: entry.groups, tier: entry.tier, tool: sc.tool, amount,
      resourceOwner: sc.resourceOwner ?? null,
      query: callArgs.query, consentGiven: callArgs.consentGiven,
      receipts: receiptsOf(v), authorizedActors: DEFAULT_ACTORS, audience: AUDIENCE, now: () => Date.now(),
    });
    const ctx = { user: sc.user, actor: sc.actor, tool: sc.tool, amount, groups: entry.groups, tier: entry.tier, aud: sc.aud };
    const trace = newTrace(req.headers.traceparent);
    // P3 evidence views: the run also carries the 10-step demo-hop/1 hops (for the reel,
    // the sequence view and the chain map) and the raw MOCK token cards, adapter output.
    const demoHops = buildDemoHops({ verdict, user: sc.user, actor: sc.actor, tool: sc.tool, amount, token, trace, aud: sc.aud, consent: true });
    const run = {
      ...verdict, tool: sc.tool, user: sc.user, act: token.act ?? null,
      chainDepth: actChainDepth(token.act), groups: entry.groups, tier: entry.tier,
      ucId: sc.ucId, scenarioId: sc.id, workspace: ws, obligation, amount: amount ?? null,
      narrative: explain(verdict, ctx), lesson: lessonFor(verdict, ctx),
      products: productCast(verdict), hops: toDemoHops(buildHops({ verdict, ...ctx, token, trace, consent: true }), { decision: verdict.decision }), tokens: tokenCardsFrom({ exchangeToken: token }),
      demoHops, tokens10: buildTokenCards({ user: sc.user, actor: sc.actor, tool: sc.tool, token, aud: sc.aud }),
      traceId: trace.traceId,
    };
    workspaces.record(ws, { tool: sc.tool, decision: verdict.decision, reason: verdict.reason, token, blocked: verdict.code, ucId: sc.ucId });
    const by = verdict.decision === 'OBLIGATION' ? 'gateway' : 'authorize';
    return res.json({ handling: 'in-app', ucId: sc.ucId, scenarioId: sc.id, decision: verdict.decision, say: verdict.reason, obligation: obligation ?? undefined, run, hops: run.hops, demoHops: run.demoHops, tokens10: run.tokens10, reply: { text: verdict.reason, by, outcome: verdict.decision, ucId: sc.ucId, tool: sc.tool } });
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // P9: the mock airline booking system. Per-workspace, integer cents, idempotent on
  // the client's key: replaying the same key returns the SAME booking, never a second charge.
  api.get('/bookings', withWorkspace((ws, _req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ schema: 'bookings/1', ...bookingsOf(workspaces.state(ws)).state() });
  }));

  api.post('/bookings/book', withWorkspace((ws, req, res) => {
    const { fareId, key } = req.body ?? {};
    const r = bookingsOf(workspaces.state(ws)).book({ fareId, key });
    if (r.error) return res.status(400).json({ error: r.error });
    res.set('Cache-Control', 'no-store');
    res.json({ schema: 'bookings/1', replay: r.replay, ...bookingsOf(workspaces.state(ws)).state() });
  }));

  api.post('/bookings/cancel', withWorkspace((ws, req, res) => {
    const r = bookingsOf(workspaces.state(ws)).cancel({ id: req.body?.id });
    if (r.error) return res.status(400).json({ error: r.error });
    res.set('Cache-Control', 'no-store');
    res.json({ schema: 'bookings/1', ...bookingsOf(workspaces.state(ws)).state() });
  }));

  // P10 Real SIGN-IN only (owner-run). GET: availability, who is signed in, the username to prefill.
  // POST {password}: the pi.flow sign-in on the server (realSignin.js). The password is used once and never
  // stored, logged or returned; errors are fixed text. Sign-out clears the session server-side.
  api.get('/signin', withWorkspace((ws, _req, res) => {
    const why = realSignin.problem();
    const s = why ? null : realSignin.session(ws);
    res.set('Cache-Control', 'no-store');
    res.json({ available: why === null, reason: why, method: 'pi.flow', redirect: false, provider: realSignin.provider(), username: why ? null : realSignin.username(), signedIn: Boolean(s), user: s ? realSignin.userOf(s) : null });
  }));

  api.post('/signin', withWorkspace(async (ws, req, res) => {
    res.set('Cache-Control', 'no-store');
    const why = realSignin.problem();
    if (why) return res.status(409).json({ error: 'real_not_available', message: why });
    const pw = req.body?.password;
    if (typeof pw !== 'string' || pw.length < 1 || pw.length > 256) return res.status(400).json({ error: 'bad_password', detail: 'type the password (1 to 256 characters)' });
    let out;
    try { out = await realSignin.signIn(ws, pw); } catch (e) {
      if (e instanceof RealRefused) return res.status(e.status).json({ error: e.code, message: e.message });
      throw e;
    }
    if (!out.ok) return res.status(out.status).json({ error: out.error, message: out.message, idp: out.idp ?? null, steps: out.steps });
    return res.json({ signedIn: true, user: out.user, steps: out.steps, tokens: out.tokens });
  }));

  api.post('/signout', withWorkspace((ws, _req, res) => {
    res.set('Cache-Control', 'no-store');
    realSignin.signOut(ws);
    res.json({ signedIn: false });
  }));

  api.post('/reset', withWorkspace((ws, _req, res) => {
    workspaces.resetWorkspace(ws);
    res.json({ reset: 'ok', workspace: ws });
  }));

  api.get('/shelf', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo(process.env)); });

  // P5: the Use Cases launcher — one row per catalog use case with where it runs. The
  // href (null behind a plain port) is built only from the fixed PROXY_PATHS allow-list.
  // Registered BEFORE the /api 404 catch-all below — on main this route sat after it and
  // answered 404 (the web tests mock the API, so it went unnoticed until now).
  api.get('/usecases', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const entries = usecaseEntries(CATALOG);
    const rows = usecaseRows(CATALOG);
    const uc = typeof req.query.uc === 'string' && /^[A-Za-z0-9.-]{1,40}$/.test(req.query.uc) ? req.query.uc : null;
    const app = typeof req.query.app === 'string' && /^[a-z0-9-]{2,40}$/.test(req.query.app) ? req.query.app : null;
    const href = uc && app ? handoffHref(rows.find((r) => r.id === uc), app, uc, req.headers['x-forwarded-prefix'] ? '/ai-demo-standalone/' : '/') : null;
    return res.json({ schema: 'usecases/1', count: entries.length, useCases: entries, rows, href });
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  mountShelfRoute(app);
  // ShelfLink (vendored, pinned) fetches GET /api/shelf; mountShelfRoute serves /shelf.
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
    app.get(/^\/(?!api\/|\/api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
