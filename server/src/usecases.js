// usecases: where each use case runs, for the Use Cases launcher page (plan phase P5).
// data/handoff.json is the owner's routing table (vendored from customer-agent-LAB,
// sha-pinned in PROVENANCE). Combined with this lab's own reality:
//   - 'Here'/'Here + go deeper' rows the lab has NOT built in-app yet (P6 pending) still
//     resolve to their deeper app when there is one, else they are "built here" only once
//     P6 lands — the page shows them as Runs here only when a scenario actually backs them.
//   - 'Hand off' rows become the Open <app> link: <proxyPath>?from=ai-demo-standalone&uc=<id>
//     (ids only; the lab proxy keeps one lab cookie per browser, so never a second tab).
//   - 'Guide' rows render the guide card copy inline.
// The link target comes ONLY from the fixed PROXY_PATHS allow-list, never from the request,
// so there is no open redirect. Handled on the server so the counts are pinned in tests.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REDIRECTS } from './assistant.js';
import { SCENARIOS } from './policyData.js';

const handoff = JSON.parse(readFileSync(fileURLToPath(new URL('../data/handoff.json', import.meta.url)), 'utf8'));
const ROUTES = handoff.routes ?? {};

// The lab-proxy route table: server/data/proxy-paths.json, vendored from customer-agent-LAB
// web/src/handoff.js PROXY_PATHS (paths only) and sha-pinned in server/data/proxy-paths.json.sha256
// (server/test/vendoredPins.test.js). Paths only — the href builder composes relative links; a
// row whose app has no path gets no link — behind a plain port the button reads
// "Start <app> from the Shelf" instead.
export const PROXY_PATHS = Object.freeze(JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/proxy-paths.json', import.meta.url)), 'utf8'),
));

const SELF_ID = 'ai-demo-standalone';
const APP_ID = /^[a-z0-9-]{2,40}$/;

// The A2A use cases run in-process too (the A2A panel: two exchanges + the registry-driven
// tool call), not through an SCENARIOS row. Pinned here so the in-app derivation yields the
// owner's 31 (Appendix A: 31 in-app, 45 redirect, 11 guide).
const PANEL_WIRED = ['UC2', 'UC2.5', 'UC2.6', 'UC2.7'];

/** The launcher rows: one per use case, { id, route, apps, path, runsHere }. */
export function usecaseRows(catalog) {
  return (catalog.useCases ?? []).map((u) => {
    const r = ROUTES[u.id] ?? {};
    // in-app: the matcher's REDIRECTS table is authoritative for redirects; a Here row with
    // a wired scenario runs here; Guide is text only.
    if (Object.hasOwn(REDIRECTS, u.id)) {
      const app = REDIRECTS[u.id];
      return { id: u.id, title: u.title ?? u.explicitTitle ?? u.id, route: 'Hand off', apps: [app], path: PROXY_PATHS[app] ?? null, runsHere: false };
    }
    const scenario = SCENARIOS.some((s) => s.ucId === u.id);
    const panel = PANEL_WIRED.includes(u.id);
    if ((r.route === 'Guide' || (!scenario && !panel && !r.app))) {
      return { id: u.id, title: u.title ?? u.explicitTitle ?? u.id, route: 'Guide', apps: [], path: null, runsHere: false };
    }
    if (scenario || panel) {
      const apps = r.app && APP_ID.test(r.app) ? [r.app, ...(r.also ? [r.also] : [])] : [];
      return { id: u.id, title: u.title ?? u.explicitTitle ?? u.id, route: 'Here + go deeper', apps, path: apps[0] ? PROXY_PATHS[apps[0]] ?? null : null, runsHere: true };
    }
    // Hand off (or a Here row with no scenario yet): the deeper app is the way in.
    const apps = [r.app, ...(r.also ? [r.also] : [])].filter((a) => typeof a === 'string' && APP_ID.test(a));
    if (!apps.length) return { id: u.id, title: u.title ?? u.explicitTitle ?? u.id, route: 'Guide', apps: [], path: null, runsHere: false };
    return { id: u.id, title: u.title ?? u.explicitTitle ?? u.id, route: 'Hand off', apps, path: PROXY_PATHS[apps[0]] ?? null, runsHere: false };
  });
}

const HANDLING = (row) => (row.runsHere ? 'in-app' : row.route === 'Hand off' ? 'redirect' : 'guide');
/** The /api/usecases entries: one per use case, { id, track, title, expectedOutcome, handling, app, proxyPath }. */
export function usecaseEntries(catalog) {
  return (catalog.useCases ?? []).map((u) => {
    const row = usecaseRows({ useCases: [u] })[0];
    return {
      id: u.id,
      track: u.track ?? null,
      title: u.title ?? u.explicitTitle ?? u.id,
      expectedOutcome: u.expectedOutcome ?? null,
      handling: HANDLING(row),
      app: row.apps[0] ?? null,
      proxyPath: row.path ?? null,
    };
  });
}

/** The href for a row's app, or null: proxy mode -> relative proxy path; direct -> no link. */
export function handoffHref(row, app, uc, pathname) {
  if (!row || typeof uc !== 'string' || !/^[A-Za-z0-9.-]{1,40}$/.test(uc)) return null;
  if (!row.apps.includes(app)) return null;
  const path = Object.hasOwn(PROXY_PATHS, app) ? PROXY_PATHS[app] : null;
  if (!path) return null;
  if (typeof pathname !== 'string' || !/^\/ai-demo-standalone\//.test(pathname.replace(/\/{2,}/g, '/'))) {
    return null; // behind a plain port: "Start <app> from the Shelf", no link
  }
  const dir = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  const up = '../'.repeat(dir.split('/').length - 2);
  return `${up}${path.slice(1)}?from=${SELF_ID}&uc=${encodeURIComponent(uc)}`;
}
