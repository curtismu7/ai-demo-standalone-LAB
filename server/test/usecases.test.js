// P5 Use Cases launcher: every catalog use case has exactly one handling, the counts are
// pinned (Appendix A), the href builder is proxy/direct aware, the target comes only from
// the fixed PROXY_PATHS allow-list (no open redirect), and the query carries ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usecaseRows, handoffHref, PROXY_PATHS } from '../src/usecases.js';
import { CATALOG } from '../src/story.js';
import { REDIRECTS } from '../src/assistant.js';

const rows = usecaseRows(CATALOG);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

test('every catalog use case has exactly one launcher row', () => {
  assert.equal(rows.length, CATALOG.useCases.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'no duplicate ids');
  for (const u of CATALOG.useCases) assert.ok(byId[u.id], `${u.id}: a row exists`);
});

test('counts are pinned: 9 run here (the wired scenarios), every redirect in the matcher redirects', () => {
  const here = rows.filter((r) => r.runsHere).map((r) => r.id).sort();
  assert.deepEqual(here, ['UC1', 'UC21', 'UC22', 'UC32', 'UC6', 'UC7', 'UC8', 'UC9', 'UC9A']);
  for (const [uc, lab] of Object.entries(REDIRECTS)) {
    assert.equal(byId[uc].route, 'Hand off', `${uc}: the matcher's redirect is a hand off row`);
    assert.equal(byId[uc].apps[0], lab, `${uc}: the app matches the matcher's lab`);
  }
});

test('every hand-off row names an app with a known proxy path', () => {
  for (const r of rows.filter((x) => x.route === 'Hand off')) {
    assert.ok(r.apps.length, `${r.id}: at least one app`);
    assert.ok(r.apps.every((a) => Object.hasOwn(PROXY_PATHS, a)), `${r.id}: every app is in the allow-list`);
    assert.match(r.path, /^\/[a-z0-9-]+\/$/, `${r.id}: the path is a proxy path`);
  }
});

test('rows never carry data beyond id, title, route, apps, path, runsHere', () => {
  const keys = Object.keys(rows[0]).sort();
  assert.deepEqual(keys, ['apps', 'id', 'path', 'route', 'runsHere', 'title']);
});

test('handoffHref: proxy mode builds <up>/<proxyPath>?from=ai-demo-standalone&uc=<id>', () => {
  const row = byId.UC12; // stolen-token-lab -> /stolen-token-lab/
  const href = handoffHref(row, 'stolen-token-lab', 'UC12', '/ai-demo-standalone/');
  assert.equal(href, '../stolen-token-lab/?from=ai-demo-standalone&uc=UC12');
});

test('handoffHref: direct mode (plain port) returns null — "Start <app> from the Shelf"', () => {
  const row = byId.UC12;
  assert.equal(handoffHref(row, 'stolen-token-lab', 'UC12', '/'), null);
  assert.equal(handoffHref(row, 'stolen-token-lab', 'UC12', '/index.html'), null);
});

test('handoffHref: no open redirect — an app outside the row or the allow-list is refused', () => {
  const row = byId.UC12;
  assert.equal(handoffHref(row, 'obo-lab', 'UC12', '/ai-demo-standalone/'), null, 'the app must be one of the row\'s apps');
  assert.equal(handoffHref({ apps: ['../evil'], path: null }, '../evil', 'UC12', '/ai-demo-standalone/'), null, 'an app outside the allow-list has no path');
});

test('handoffHref: the query carries ids only; a malformed uc is refused', () => {
  const row = byId.UC12;
  assert.equal(handoffHref(row, 'stolen-token-lab', '../../etc', '/ai-demo-standalone/'), null);
  assert.equal(handoffHref(row, 'stolen-token-lab', null, '/ai-demo-standalone/'), null);
  const href = handoffHref(row, 'stolen-token-lab', 'UC.12b-x', '/ai-demo-standalone/');
  assert.ok(href.includes('uc=UC.12b-x'), 'id-shaped ucs pass');
});
