// The vendored shared/hop-detail copy is the original plus only the edits server/src/vendor/hop-detail.sha256 describes
// (re-vendor from AI-DEMO-Standalone, never edit): the catalog byte for byte, hopDetail.mjs under one header line, and the test file
// under one header line with its two import paths adjusted. Each pin is the hash of the shared original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(here, '..', 'src', 'vendor');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const withoutHeader = (text) => text.slice(text.indexOf('\n') + 1);

const pinText = fs.readFileSync(path.join(vendor, 'hop-detail.sha256'), 'utf8');
const pinCommit = pinText.split('\n')[0].match(/^# vendored from curtismu7\/AI-DEMO-Standalone shared\/hop-detail at ([0-9a-f]{7,40}) \(main\)/)?.[1];
const pins = Object.fromEntries(pinText.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/).reverse()));

test('the pin file names the parent commit and exactly the three shared originals', () => {
  assert.ok(pinCommit, 'first line names the AI-DEMO-Standalone commit');
  assert.deepEqual(Object.keys(pins).sort(), ['hop-catalog.json', 'hopDetail.mjs', 'hopDetail.test.mjs']);
  assert.deepEqual(fs.readdirSync(vendor).sort(), ['hop-catalog.json', 'hop-detail.sha256', 'hopDetail.mjs']);
});

test('hop-catalog.json is byte for byte the shared original', () => {
  assert.equal(sha(fs.readFileSync(path.join(vendor, 'hop-catalog.json'))), pins['hop-catalog.json']);
});

test('hopDetail.mjs is the shared original under one header line that names the same commit', () => {
  const text = fs.readFileSync(path.join(vendor, 'hopDetail.mjs'), 'utf8');
  assert.equal(text.split('\n')[0], `// Vendored from AI-DEMO-Standalone shared/hop-detail/hopDetail.mjs @ ${pinCommit}. Edit the shared copy first, then re-copy.`);
  assert.equal(sha(withoutHeader(text)), pins['hopDetail.mjs']);
});

test('server/test/hopDetail.test.js is the shared test under one header line, with only its two import paths adjusted', () => {
  const text = fs.readFileSync(path.join(here, 'hopDetail.test.js'), 'utf8');
  assert.equal(text.split('\n')[0], `// Vendored from AI-DEMO-Standalone shared/hop-detail/hopDetail.test.mjs @ ${pinCommit} (paths adjusted).`);
  const adjusted = [["from '../src/vendor/hopDetail.mjs'", "from './hopDetail.mjs'"], ["path.join(here, '../src/vendor/hop-catalog.json')", "path.join(here, 'hop-catalog.json')"]];
  let original = withoutHeader(text);
  for (const [now, was] of adjusted) {
    assert.equal(original.split(now).length - 1, 1, `${now} appears once`);
    original = original.replace(now, was);
  }
  assert.equal(sha(original), pins['hopDetail.test.mjs']);
});
