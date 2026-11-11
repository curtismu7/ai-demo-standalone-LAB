// The vendored routing table is byte for byte what the pin files record; a hand edit
// (or a re-copy from a different source commit) fails here before it can drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = (f) => fs.readFileSync(path.join(root, 'data', f), 'utf8').trim();

test('server/data/handoff.json matches server/data/handoff.json.sha256', () => {
  const p = pin('handoff.json.sha256');
  assert.match(p, /^[0-9a-f]{64}  server\/data\/handoff\.json$/, 'the pin names the file');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'data', 'handoff.json'))).digest('hex'), p.split(' ')[0]);
});

test('server/data/proxy-paths.json matches server/data/proxy-paths.json.sha256', () => {
  const p = pin('proxy-paths.json.sha256');
  assert.match(p, /^[0-9a-f]{64}  server\/data\/proxy-paths\.json$/, 'the pin names the file');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'data', 'proxy-paths.json'))).digest('hex'), p.split(' ')[0]);
});

test('proxy-paths.json: paths only, no URLs, no scheme, no query', () => {
  const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'proxy-paths.json'), 'utf8'));
  for (const [app, p] of Object.entries(map)) {
    assert.match(app, /^[a-z0-9-]{2,40}$/);
    assert.match(p, /^\/[a-z0-9-]+\/$/, `${app}: a relative proxy path only`);
  }
});
