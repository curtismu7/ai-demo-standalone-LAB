import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7810:7810"', '- "0.0.0.0:7810:7810"', '- 7810', '- "::1:7810:7810"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose default host port and Dockerfile port are allowed ports and agree', () => {
  const compose = here('docker-compose.yml');
  const host = Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]);
  assert.equal(portProblem(host), null);
  const docker = here('Dockerfile');
  const port = Number(/^EXPOSE (\d+)/m.exec(docker)[1]);
  assert.equal(portProblem(port), null);
  assert.match(compose, new RegExp(`:${port}"`));
  assert.match(docker, /^ENV AIDEMOLAB_BIND=0\.0\.0\.0$/m);
  assert.match(docker, /^USER node$/m);
});

test('the container is locked down: read-only fs, no capabilities, no new privileges', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
});

// P2b: the brain sidecar is OFF by default and gives the sidecar nothing it could exfiltrate with.
test('the brain sidecar is profile-gated, publishes no port, and sets no env_file', () => {
  const compose = here('docker-compose.yml');
  const brain = /  brain:\n(?:    .*\n)*/.exec(compose)?.[0] ?? '';
  assert.ok(brain, 'the compose file declares the brain service');
  assert.match(brain, /profiles:\s*\["?brain"?\]/, 'the sidecar runs only under the brain profile (off by default)');
  assert.doesNotMatch(brain, /ports:/, 'the sidecar publishes NO host port');
  assert.doesNotMatch(brain, /env_file:/, 'the sidecar gets no env_file (no host .env, no secrets file)');
  assert.match(brain, /network_mode:\s*"service:ai-demo-standalone"/, 'the sidecar shares the lab network namespace (nothing of its own is exposed)');
  assert.match(brain, /restart: unless-stopped/, 'rule 21');
  // the lab service itself does not wait for the sidecar and does not enable the profile
  const lab = compose.split('  brain:')[0];
  assert.doesNotMatch(lab, /depends_on:\s*\n\s*-?\s*brain/, 'the lab never waits for the sidecar');
  assert.match(compose, /AIDEMO_BRAIN_URL:\s*\$\{AIDEMO_BRAIN_URL:-\}/, 'the model URL is empty by default: no model call');
});
