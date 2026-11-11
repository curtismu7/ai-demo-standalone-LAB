// shelf-link service: server side. Every -LAB app mounts GET /api/shelf, which returns the
// shelf (launcher) URL from the environment: SHELF_URL, or the settings file that
// STANDALONE_ENV points at (key SHELF_URL). Never ~/Development/.env — per-repo or
// per-service env files only. No hardcoded host here (hygiene: repo text carries only
// .invalid/.example names): unconfigured means shelfUrl null and the web component
// renders nothing.
import fs from 'node:fs';

function readShelfUrl(env = process.env) {
  if (env.SHELF_URL) return String(env.SHELF_URL).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  if (env.STANDALONE_ENV) {
    try {
      const text = fs.readFileSync(env.STANDALONE_ENV, 'utf8');
      const m = text.split('\n').map((l) => l.match(/^SHELF_URL=(.*)$/)).find(Boolean);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
    } catch { /* configured file missing: stay null */ }
  }
  return null;
}

export function shelfInfo(env = process.env) {
  return { shelfUrl: readShelfUrl(env) };
}

export function mountShelfRoute(router, { env = process.env } = {}) {
  router.get('/shelf', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(shelfInfo(env));
  });
}
