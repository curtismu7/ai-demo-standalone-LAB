// The vendored return-link files are byte for byte what web/src/return-link/return-link.sha256 pins (re-vendor from AI-DEMO-Standalone, never edit).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'return-link');

test('vendored return-link matches its pinned hashes and names the parent commit', () => {
  const text = fs.readFileSync(path.join(dir, 'return-link.sha256'), 'utf8');
  assert.match(text.split('\n')[0], /^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
  const pins = text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  assert.deepEqual(pins.map(([, f]) => f).sort(), ['ReturnLink.jsx', 'ReturnLink.test.jsx', 'returnTargets.js']);
  for (const [h, f] of pins) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), h, f);
});
