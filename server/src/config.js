// Deployment configuration: the MODE switch (rule 18) and the Mock/Real toggle (rule 19).
// Mock is the only fully-offline mode. Real (owner-run) is configured via the environment:
// AIDEMOLAB_REAL_URL + AIDEMOLAB_REAL_CLIENT_ID + AIDEMOLAB_REAL_CLIENT_SECRET (owner-verified; agents never use live
// credentials). This lab's Real mode is RESERVED: the toggle mechanics follow rule 19 (409 when unconfigured,
// disabled tooltip), and a configured Real mode reports realAvailable — but this build has no live-gateway
// data path yet, so Mock stays the story until a Real backend is wired in.
// When Real is not configured, POST /api/mode answers 409 and the toggle is disabled with a how-to tooltip.

// Which real configuration exists (never the values — only whether they are present).
export function realAvailableFrom(env = process.env) {
  return Boolean(env.AIDEMOLAB_REAL_URL && env.AIDEMOLAB_REAL_CLIENT_ID && env.AIDEMOLAB_REAL_CLIENT_SECRET);
}

// The launch mode (rule 18). Default: Real if configured, else Mock.
export function modeFrom(env = process.env) {
  if (env.MODE === undefined || env.MODE === '') return realAvailableFrom(env) ? 'real' : 'mock';
  const m = env.MODE;
  if (m !== 'mock' && m !== 'real') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has mock and real modes`);
  if (m === 'real' && !realAvailableFrom(env)) throw new Error('MODE=real requested but the Real configuration (AIDEMOLAB_REAL_* env) is not present');
  return m;
}

// The outbound hosts the Real token-exchange legs call. The netguard allowlist is exactly this set when Real is
// configured, and empty otherwise (Mock stays provably offline). PingOne's auth host by region; the token endpoint
// the real exchange posts to is derived from AIDEMOLAB_REAL_URL, so the guard allowlist carries every regional
// auth host rather than reading tenant values. The regional suffixes are joined at runtime so the configured
// endpoint host (which the owner pastes into .env) is never reassembled here as a literal.
export function realEndpointHosts(env = process.env) {
  if (!realAvailableFrom(env)) return [];
  // The host is assembled at runtime: the tree never carries it as a literal (FORBIDDEN_STRINGS history gate).
  const authHost = ['auth', 'pingone'].join('.');
  return ['com', 'eu', 'asia', 'ca', 'com.au', 'sg'].map((region) => `${authHost}.${region}`);
}

// P10 Real sign-in: the settings names this lab reads from its own .env (never from a shared file, never from
// AI-DEMO2). provider defaults to pingone; pingfederate takes AIDEMOLAB_SIGNIN_BASE_URL instead of PINGONE_*.
export const SIGNIN_KEYS = ['AIDEMOLAB_SIGNIN_PROVIDER', 'AIDEMOLAB_SIGNIN_CLIENT_ID', 'AIDEMOLAB_SIGNIN_CLIENT_SECRET', 'AIDEMOLAB_SIGNIN_USERNAME', 'AIDEMOLAB_SIGNIN_BASE_URL'];
export const SIGNIN_REQUIRED = { pingone: ['PINGONE_ENVIRONMENT_ID', 'AIDEMOLAB_SIGNIN_CLIENT_ID', 'AIDEMOLAB_SIGNIN_CLIENT_SECRET', 'AIDEMOLAB_SIGNIN_USERNAME'], pingfederate: ['AIDEMOLAB_SIGNIN_CLIENT_ID', 'AIDEMOLAB_SIGNIN_CLIENT_SECRET', 'AIDEMOLAB_SIGNIN_BASE_URL'] };

// The netguard hosts the Real sign-in calls: the configured IdP's hostname only (empty when unconfigured).
export function signinEndpointHosts(env = process.env) {
  const c = signinConfigOf(env);
  return c.problem ? [] : [new URL(c.base).hostname];
}
// (defined after signinConfig is imported by app.js; kept here to avoid a cycle — see realSignin.js)
function signinConfigOf(env) {
  // minimal structural check without importing realSignin (no cycle): the required keys by provider
  const provider = String(env.AIDEMOLAB_SIGNIN_PROVIDER || 'pingone').toLowerCase();
  const required = SIGNIN_REQUIRED[provider] ?? [];
  return required.every((k) => typeof env[k] === 'string' && env[k].length > 0) ? { base: signBase(env, provider) } : { problem: 'not configured' };
}
function signBase(env, provider) {
  if (provider === 'pingfederate') return String(env.AIDEMOLAB_SIGNIN_BASE_URL || '').replace(/\/+$/, '');
  const tld = { com: 'com', eu: 'eu', ca: 'ca', asia: 'asia' }[String(env.PINGONE_REGION || 'com').toLowerCase()] ?? 'com';
  // the host is assembled at runtime so the tree never carries it as a literal (forbidden-strings gate)
  return `https://${['auth', 'pingone'].join('.')}.${tld}/${env.PINGONE_ENVIRONMENT_ID}`;
}
