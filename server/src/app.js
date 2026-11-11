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
import { decide, actChainDepth, DEFAULT_ACTORS, AUDIENCE, exchange } from './pdp.js';
import { DEFAULT_DIRECTORY, LIMITS } from './pdpData.js';
import { mountShelfRoute } from './shelfLink.js';
import { explain, lessonFor, buildHops, newTrace, productCast } from './explain.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({
  health = createHealth(), configFile = CONFIG, hosted = false,
  workspaces = createWorkspaces({ makeDirectory: () => structuredClone(DEFAULT_DIRECTORY) }),
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
    const verdict = decide({
      token: body.token, groups: entry.groups, tier: entry.tier, tool, amount,
      authorizedActors: Array.isArray(body.authorizedActors) ? body.authorizedActors.slice(0, 8).map((a) => String(a).slice(0, LIMITS.id)) : DEFAULT_ACTORS,
      audience: typeof body.aud === 'string' && body.aud.trim() ? body.aud.trim().slice(0, 100) : AUDIENCE,
      now: () => Date.now(),
    });
    workspaces.record(ws, { tool, decision: verdict.decision, reason: verdict.reason, token: body.token, blocked: verdict.code, ucId });
    const ctx = { user: body.token.sub, actor: body.token.act?.sub || null, tool, amount, groups: entry.groups, tier: entry.tier, aud: body.aud };
    const trace = newTrace(req.headers.traceparent);
    return res.status(verdict.decision === 'PERMIT' ? 200 : 403).json({
      ...verdict, tool, user: body.token.sub, act: body.token.act ?? null,
      chainDepth: actChainDepth(body.token.act), groups: entry.groups, tier: entry.tier,
      ucId, workspace: ws,
      // the teaching layer
      narrative: explain(verdict, ctx),
      lesson: lessonFor(verdict, ctx),
      products: productCast(verdict),
      hops: buildHops({ verdict, ...ctx, token: body.token, trace, consent: true }),
      traceId: trace.traceId,
    });
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
