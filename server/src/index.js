import { fileURLToPath } from 'node:url';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom, realAvailableFrom, realEndpointHosts, signinEndpointHosts } from './config.js';

// The .env (this lab's own, beside docker-compose.yml) is read BEFORE the netguard is installed: loading a file
// opens no socket, and the guard's allowlist is derived from that configuration (Real sign-in's IdP host, the
// AIDEMOLAB_REAL_* exchange hosts). In Docker, compose substitutes the same names into the environment directly.
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

// The outbound allowlist is exactly what Real mode calls when configured, and empty otherwise: Mock mode stays
// provably offline. The Real sign-in's IdP host joins only when the sign-in is configured (P10).
installNetguard({ outboundAllow: [...realEndpointHosts(), ...signinEndpointHosts()] }); // before anything else can open a socket

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[ai-demo-standalone] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
console.log(`[ai-demo-standalone] starting in ${modeFrom()} mode`);
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[ai-demo-standalone] lab at ${url} (loopback${realAvailableFrom() ? ', Real configured' : ', Mock only — no outbound network'})`);
console.log(`[ai-demo-standalone] health: ${url}api/health`);
