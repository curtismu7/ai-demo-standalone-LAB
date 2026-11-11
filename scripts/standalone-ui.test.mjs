// The vendored stylesheet is byte for byte what scripts/standalone-ui.sha256 pins (the hash of AI-DEMO-Standalone shared/standalone-ui.css).
// scripts/check-ui-standard.sh additionally compares it to the canonical copy on GitHub; this offline check catches a hand-edited copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('web/src/styles/standalone-ui.css matches scripts/standalone-ui.sha256', () => {
  const pin = fs.readFileSync(path.join(root, 'scripts', 'standalone-ui.sha256'), 'utf8').trim();
  assert.match(pin, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'web', 'src', 'styles', 'standalone-ui.css'))).digest('hex'), pin);
});
