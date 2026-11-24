// Rule 27: the vendored shared/run-observability files match web/src/run-observability/run-observability.sha256 byte for byte.
// They come from curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here.
// This lab reads no logs, so it vendors the core only: no server/src/runObservabilityReaders.js, and no file of this lab names a
// reader or a reader setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin } from './run-observability-checkPin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const VENDORED_CORE = 'server/src/runObservability.js';
const VENDORED_WEB = 'web/src/run-observability';

test('every vendored run-observability file matches its pin, and the core is present', () => {
  assert.deepEqual(checkPin(root), []);
});

test('an edited vendored byte, a missing pin and an unpinned file are each caught', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'aidemo-pin-'));
  try {
    for (const p of [VENDORED_WEB, VENDORED_CORE]) fs.cpSync(path.join(root, p), path.join(copy, p), { recursive: true });
    assert.deepEqual(checkPin(copy), [], 'an untouched copy is fine');
    const css = path.join(copy, VENDORED_WEB, 'run-observability.css');
    fs.appendFileSync(css, ' ');
    assert.ok(checkPin(copy).length > 0, 'one added byte');
    fs.writeFileSync(css, fs.readFileSync(path.join(root, VENDORED_WEB, 'run-observability.css')));
    fs.writeFileSync(path.join(copy, VENDORED_WEB, 'extra.js'), 'export {};\n');
    assert.ok(checkPin(copy).some((m) => /extra\.js/.test(m)), 'a file beside them that the pin does not name');
    fs.rmSync(path.join(copy, VENDORED_WEB, 'extra.js'));
    fs.rmSync(path.join(copy, VENDORED_WEB, 'run-observability.sha256'));
    assert.ok(checkPin(copy).length > 0, 'no pin file');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

test('this lab reads no logs: no readers file, and no server file names a reader or a reader setting (comments included)', () => {
  assert.ok(!fs.existsSync(path.join(root, 'server/src/runObservabilityReaders.js')));
  const core = read(VENDORED_CORE);
  assert.ok(!/^\s*import\s/m.test(core), 'the core has no imports');
  for (const f of fs.readdirSync(path.join(root, 'server/src'), { recursive: true }).filter((n) => n.endsWith('.js') && n !== 'runObservability.js')) {
    assert.ok(!/RUN_OBS_|runObservabilityReaders|ElasticsearchReader|DockerLogReader|readersFromEnv/.test(read(`server/src/${f}`)), `server/src/${f} names a log reader`);
  }
});

test('no lab file outside the vendored files carries the RUN_OBS_ prefix (the web code included)', () => {
  const walk = (rel) => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((d) => {
    const child = `${rel}/${d.name}`;
    if (d.isDirectory()) return d.name === 'node_modules' || child === VENDORED_WEB ? [] : walk(child);
    return child === VENDORED_CORE ? [] : [child];
  });
  for (const f of [...walk('web/src'), ...walk('server/src')]) assert.ok(!/RUN_OBS_/.test(read(f)), `${f} carries a RUN_OBS_ name`);
});
