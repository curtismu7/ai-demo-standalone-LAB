// P5 Use Cases launcher: every catalog use case has exactly one handling, the counts are
// pinned (Appendix A), the href builder is proxy/direct aware, the target comes only from
// the fixed PROXY_PATHS allow-list (no open redirect), and the query carries ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usecaseRows, handoffHref, PROXY_PATHS } from '../src/usecases.js';
import { CATALOG } from '../src/story.js';
import { REDIRECTS } from '../src/assistant.js';
import { SCENARIOS } from '../src/policyData.js';

const rows = usecaseRows(CATALOG);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

test('every catalog use case has exactly one launcher row', () => {
  assert.equal(rows.length, CATALOG.useCases.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'no duplicate ids');
  for (const u of CATALOG.useCases) assert.ok(byId[u.id], `${u.id}: a row exists`);
});

test('counts are pinned: 31 run here (the owner total: 27 scenario-backed ucIds + the 4 A2A panel use cases; P6 batch 3 grew 21 -> 31), every redirect in the matcher redirects', () => {
  const here = rows.filter((r) => r.runsHere).map((r) => r.id).sort();
  assert.deepEqual(here, ['UC1', 'UC10', 'UC11', 'UC13', 'UC16b', 'UC19', 'UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC20', 'UC21', 'UC22', 'UC24', 'UC26', 'UC27', 'UC29', 'UC3', 'UC32', 'UC33', 'UC34', 'UC35', 'UC4', 'UC41', 'UC42', 'UC5', 'UC6', 'UC7', 'UC8', 'UC9', 'UC9A']);
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

// Appendix A owner-pinned totals (2026-11-10): 31 in-app, 45 redirect to standalone apps,
// 11 guide cards. P6 batch 3 closed the batch: 27 scenario-backed ucIds + the 4 A2A panel
// use cases (UC2/2.5/2.6/2.7, wired in-process through the A2A panel) = 31.
test('Appendix A counts are pinned: 31 in-app, 45 redirects land as redirect, 11 guide — every use case classified exactly once', () => {
  const counts = { 'Hand off': 0, Guide: 0, 'Here + go deeper': 0 };
  for (const r of rows) counts[r.route] += 1;
  // Every Appendix A "Redirect ->" use case is a redirect row:
  const appendixRedirects = ['UC23', 'UC25', 'UC28', 'UC30', 'UC31', 'UC37', 'UC38', 'UC39', 'UC40', 'UC43', 'UC44', 'UC45', 'UC46', 'UC46A', 'UC47', 'UC48', 'UC12', 'UC14', 'UC14b', 'UC15', 'UC16', 'UC17', 'UC18', 'UC-TOOL3', 'UC-MUSE1', 'UC-MUSE2', 'UC-NHI1', 'UC-NHI2', 'UC-LEARN2', 'UC-LEARN3', 'UC-LEARN4', 'UC-LEARN6', 'UC-LEARN8', 'UC-LEARN9', 'UC-LEARN11', 'UC-LEARN12', 'UC-LEARN13', 'UC-LEARN14', 'UC-LEARN15', 'UC-LEARN16', 'UC-LEARN17', 'UC-LEARN19', 'UC-LOGIN', 'UC-LOGIN-PF', 'UC-OBO'];
  for (const id of appendixRedirects) assert.equal(byId[id].route, 'Hand off', `${id}: Appendix A redirect`);
  assert.equal(appendixRedirects.length, 45, 'the owner-pinned redirect total');
  // Every Appendix A guide row is a Guide row (the text-only cards):
  for (const id of ['UC-LEARN1', 'UC-LEARN5', 'UC-LEARN7', 'UC-LEARN10', 'UC-LEARN18', 'UC-PAM-SETUP', 'UC-PAM-SCRIPT', 'UC-TOOL1', 'UC-TOOL2', 'UC-LOGIN-AIC', 'UC-AIC-TX']) assert.equal(byId[id].route, 'Guide', `${id}: Appendix A guide`);
  assert.equal(counts.Guide, 11, 'exactly the Appendix guide cards are Guide rows (P6 built the rest in-app)');
  assert.equal(counts['Here + go deeper'], 31, 'the owner-pinned in-app total');
  assert.equal(counts['Hand off'] + counts.Guide + counts['Here + go deeper'], CATALOG.useCases.length, 'every use case classified exactly once');
  const scenarios = new Set(SCENARIOS.map((s) => s.ucId));
  const derived = [...scenarios].filter((id) => byId[id] && byId[id].runsHere).length + rows.filter((r) => r.runsHere && !SCENARIOS.some((s) => s.ucId === r.id)).length;
  assert.equal(counts['Here + go deeper'], derived, 'in-app is derived (SCENARIOS + the A2A panel), not hardcoded');
});

test('guide rows carry no app link; run-here rows come from the scenario table or the A2A panel', () => {
  for (const r of rows) {
    if (r.route === 'Guide') assert.equal(r.apps.length, 0, `${r.id}: guide has no app`);
    if (r.runsHere) assert.ok(SCENARIOS.some((s) => s.ucId === r.id) || ['UC2', 'UC2.5', 'UC2.6', 'UC2.7'].includes(r.id), `${r.id}: a scenario or the A2A panel backs it`);
  }
});
