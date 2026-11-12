import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// index.js starts the server at import time, so it cannot be imported in a test. Pin its order instead: the network guard
// is installed before the env file is read, the doctor runs, or any server starts.
test('the entry installs the netguard first, before it can open any socket', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const m = /^installNetguard\(/m.exec(src); // a real statement at the start of a line, not inside a comment
  assert.ok(m, 'installNetguard() is called as a statement');
  const guard = m.index;
  for (const later of ['runChecks()', 'startHttpServer({']) assert.ok(src.indexOf(later) > guard, `${later} comes after the guard`);
  // The .env is read BEFORE the guard: it opens no socket, and the allowlist is derived from its configuration
  // (the Real sign-in's IdP host and the AIDEMOLAB_REAL_* hosts). A host run was blind to its own .env otherwise.
  assert.ok(src.indexOf('loadEnvFile(') < guard, 'loadEnvFile( comes before the guard (the allowlist is derived from it)');
  assert.ok(src.indexOf("import { installNetguard }") < guard);
  // The allowlist is derived from the Real config: empty in Mock (provably offline), the PingOne auth hosts in
  // Real, plus the Real sign-in's IdP host (P10) when the sign-in is configured.
  assert.match(src.slice(guard, guard + 260), /outboundAllow: \[\.\.\.realEndpointHosts\(\), \.\.\.signinEndpointHosts\(\)\]/, 'the netguard allowlist comes from realEndpointHosts() + signinEndpointHosts()');
});
