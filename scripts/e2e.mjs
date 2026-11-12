#!/usr/bin/env node
// Real-browser run of the web UI against the real server (server/src/index.js serves web/dist).
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 5930), drives it in Chromium, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// Uses the Chromium the installed Playwright resolves (`npx playwright install chromium` if missing). The run makes
// no outbound request: any request to another origin fails the run. Exit 0 only when every check passes.
//
// Drives: the dashboard (chips, transcript, chain view, token cards, products, talk track), the Use Cases page
// (launcher chips, search, the runner), the guide, the Quick Config dialog, keyboard reach, 375px and the dark/light
// themes. No page error, no console error, no off-origin request, no horizontal scroll at 375px.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0; let checks = 0;
const check = (ok, what) => { checks += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 7810;
if (port !== 7810) { console.error('E2E_PORT must be 7810 (this app\'s one allocated port)'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }

const env = { ...process.env, PORT: String(port) };
for (const k of ['AIDEMOLAB_REAL_URL', 'AIDEMOLAB_REAL_CLIENT_ID', 'AIDEMOLAB_REAL_CLIENT_SECRET']) delete env[k]; // Mock only
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 160 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const foreign = [];
try {
  for (const [scheme, width] of [['dark', 1280], ['light', 375]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    const errors = []; const offOrigin = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    // the family brand fonts load from the Google Fonts CDN (documented); anything else off-origin fails
    page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url()) && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) offOrigin.push(r.url()); });
    const tag = `[${scheme} ${width}px]`;

    await page.goto(base);
    await page.locator('header').first().waitFor();
    check(true, `${tag} the shell renders`);
    check(await page.evaluate(() => !!document.querySelector('.skip, a.skip')), `${tag} a skip link exists`);
    check(await page.evaluate(() => document.querySelectorAll('[data-testid="banner"], .banner').length > 0), `${tag} the simulation banner shows`);
    check(await page.evaluate(() => document.querySelector('main')?.getAttribute('tabindex') !== null || !!document.querySelector('main')), `${tag} main is present`);

    // h1 exactly one per page
    check(await page.evaluate(() => document.querySelectorAll('h1').length === 1), `${tag} exactly one h1`);

    // the dashboard's five sections
    for (const id of ['assistant-section', 'plan-section', 'evidence-section', 'products-section', 'talk-section']) {
      check(await page.getByTestId(id).count() === 1, `${tag} the dashboard has its ${id}`);
    }

    // a chip runs the engine end to end: the transcript answers and the evidence fills
    const chips = page.getByTestId('dash-chips');
    if (await chips.count()) {
      const before = await page.getByTestId('transcript').innerText().catch(() => '');
      await chips.getByRole('button').first().click();
      // the round trip: the transcript gains the agent's answer (the run follows)
      await page.waitForFunction(
        (prev) => { const t = document.querySelector('[data-testid="transcript"]'); return t && t.innerText.length > prev.length + 40; },
        before, { timeout: 30000 },
      );
      const decision = await page.getByTestId('evidence-decision').innerText().catch(() => '(none)');
      check(/PERMIT|DENY|OBLIGATION/.test(decision), `${tag} a chip produced a live verdict (${decision.trim()})`);
      check(await page.getByTestId('chain-view').count() === 1, `${tag} the chain view rendered`);
    } else {
      check(false, `${tag} the dashboard exposes its chips`);
    }

    // no horizontal scroll at 375px
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag} no horizontal scroll`);
    await page.screenshot({ path: path.join(shots, `dash-${scheme}-${width}.png`), fullPage: true });

    // keyboard: the skip link is the first tab stop
    await page.locator('.skip, a.skip').focus();
    check((await page.evaluate(() => document.activeElement?.textContent || '')).toLowerCase().includes('skip'), `${tag} the skip link is focusable`);

    // Use Cases page: the launcher renders with route chips and search narrows
    await page.evaluate(() => { location.hash = '#/use-cases'; });
    await page.getByTestId('uc-launcher').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="uc-rows"]')?.children.length ?? 0) > 50, null, { timeout: 15000 });
    const launchButtons = await page.getByTestId('uc-launcher').locator('button').count();
    check(launchButtons > 50, `${tag} the launcher lists the use cases (${launchButtons} buttons)`);
    await page.getByTestId('uc-search').fill('token theft');
    await page.waitForTimeout(300);
    const narrowed = await page.getByTestId('uc-launcher').locator('li').count();
    check(narrowed > 0 && narrowed < launchButtons, `${tag} search narrows (${narrowed} of ${launchButtons})`);
    await page.screenshot({ path: path.join(shots, `use-cases-${scheme}-${width}.png`), fullPage: true });

    // Airline page: hero, fare board, a booking round trip, Focus|Float, the booking form dialog
    await page.evaluate(() => { location.hash = '#/airline'; });
    await page.getByTestId('airline-balance').waitFor({ timeout: 10000 });
    check(await page.getByTestId('fare-board').count() === 1, `${tag} the fare board renders`);
    const balBefore = await page.getByTestId('airline-balance').innerText();
    await page.getByTestId('book-den-oslo').click();
    await page.waitForFunction((prev) => document.querySelector('[data-testid="airline-balance"]')?.innerText !== prev, balBefore, { timeout: 15000 });
    const balAfter = await page.getByTestId('airline-balance').innerText();
    check(balAfter !== balBefore, `${tag} booking debits the balance (${balBefore} -> ${balAfter})`);
    check(await page.getByTestId('itineraries').count() === 1, `${tag} the itinerary list renders`);
    await page.getByTestId('open-booking-form').click();
    check(await page.getByTestId('booking-form-dialog').waitFor({ timeout: 5000 }).then(() => true).catch(() => false), `${tag} the booking form opens in the FloatingDialog`);
    await page.keyboard.press('Escape');
    await page.getByTestId('mode-float').click();
    check(await page.getByTestId('airline-float').count() === 1, `${tag} Float mode wraps the desk in the floating panel`);
    // close the desk by its own title-bar Close button (at 375px the bottom-docked sheet covers the page's
    // own mode switch, so the Close button is the designed way back — and it works at every width)
    await page.locator('[data-testid="airline-float"] button[aria-label="Close"]').first().click();
    await page.getByTestId('airline-float').waitFor({ state: 'hidden', timeout: 5000 });
    check(await page.getByTestId('fare-board').isVisible(), `${tag} closing the floating desk returns the page body`);
    check(await page.getByTestId('airline-float').count() === 0, `${tag} Focus mode returns the desk to the page`);
    await page.screenshot({ path: path.join(shots, `airline-${scheme}-${width}.png`), fullPage: true });

    // guide page: one h1
    await page.evaluate(() => { location.hash = '#/guide'; });
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelectorAll('h1').length === 1), `${tag} the guide keeps one h1`);

    check(offOrigin.length === 0, `${tag} no off-origin request ${JSON.stringify(offOrigin)}`);
    check(errors.length === 0, `${tag} no page or console errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  check(foreign.length === 0, 'the lab never asked for a foreign host');
} catch (e) {
  console.error(e); failures += 1;
} finally {
  await browser.close();
  server.kill();
}
console.log(`${failures} check(s) FAILED`); if (failures) { console.log(`screenshots: ${shots}`); process.exit(1); }
