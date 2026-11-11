// The copy rule (owner, 2026-11-10): everything this app reuses from AI-DEMO2 is COPIED INTO this repo and committed. Nothing here may
// refer to a running AI-DEMO2 at run time or build time, because it will not exist on other people's machines.
//
// This test reads every tracked file (and every untracked file git does not ignore) and fails on:
//   - an AI-DEMO2 hostname, a container, image, network or volume name of its stack, its checkout path, or one of its env var names
//   - an external Docker network or volume, a compose path that leaves the repo
//   - a Dockerfile COPY --from / --mount from something the Dockerfile does not build itself, or a FROM of an AI-DEMO2 image
//   - a relative import, URL or CSS @import that leaves the repo (and a dependency on a path or repo outside it)
// Allowed prose: docs/PROVENANCE.md and CHANGELOG.md in full, README.md lines that open with an attribution word, and the leading comment
// block of a vendored file. Bare prose such as "a mock of the AI-DEMO2 dashboard" is not an identifier and is not flagged.
// The forbidden spellings are built from fragments so that this file does not contain them and passes its own scan with no exemption.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const f = (...p) => p.join('');
const lit = (...parts) => f(...parts).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const SOURCE_REPO_NAME = new RegExp(f('ai-demo', '2'), 'i');
const OWN_NAME = 'standalone'; // this app is ai-demo-standalone: that name and the parent repo AI-DEMO-Standalone are ours

// Text rules: a match anywhere in a scanned file is a violation.
const TEXT_RULES = [
  { id: 'hostname', re: new RegExp(`${lit('ai-demo', '.ping-devops.com')}|(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*ping\\.demo\\b`, 'gi') },
  { id: 'container-or-network-name', re: new RegExp(`\\bai-demo[-_](?!${OWN_NAME}\\b)[a-z0-9][a-z0-9_-]*`, 'gi') },
  { id: 'image-or-registry', re: new RegExp(`${lit('ghcr.io/c', 'muir_ping', 'corp')}|\\bai-demo2[-_][a-z0-9_-]*`, 'gi') },
  { id: 'checkout-path', re: new RegExp(`${lit('Development/', 'AI-DEMO2')}|${lit('/', 'AI-DEMO2', '/')}`, 'gi') },
  { id: 'env-var', re: new RegExp(`${lit('AI_DEMO2', '_')}[A-Z0-9_]*`, 'gi') },
];

// Pre-existing mentions, kept in the open and kept narrow: (file, exact matched text, why). Each must still be present, so
// an entry goes stale loudly and the exception is removed when the text is.
const KNOWN = [
  { file: 'server/data/catalog.json', text: f('ai-demo', '-catalog'), why: "the catalog's own schema label, returned by /api/catalog; not a container" },
  { file: 'CLAUDE.md', text: f('ai-demo', '-catalog'), why: 'names that schema label' },
  { file: 'server/data/catalog.json', text: f('ai-demo', '-pf-rar'), why: 'a client name in one use case narrative (prose only, nothing connects to it); reword when the catalog is regenerated' },
  { file: 'server/data/catalog.json', text: f('obo-demo.ping', '.demo'), why: 'an audience name in one use case narrative (prose only); reword when the catalog is regenerated' },
  { file: 'server/data/catalog.json', text: f('ai-demo2', '-bff'), why: 'an index name in one use case narrative (prose only); reword when the catalog is regenerated' },
];

const PROSE_FILES = new Set(['docs/PROVENANCE.md', 'CHANGELOG.md']);
const README_ATTRIBUTION = /^\s*(?:[-*>]\s*)?(?:Ported|Copied|Adapted|Derived|Extracted|Forked)\b/i;
const VENDORED = ['web/src/evidence/', 'web/src/floating-dialog/', 'web/src/return-link/', 'web/src/styles/standalone-ui.css', 'web/src/components/tokenchain/', 'server/src/vendor/', 'server/test/hopDetail.test.js'];

const isDockerfile = (rel) => /(^|\/)Dockerfile(\.[^/]+)?$|\.Dockerfile$/.test(rel);
const isCompose = (rel) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(rel);
const isScript = (rel) => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(rel);
const leaves = (fromRel, spec) => {
  const rel = path.relative(root, path.resolve(root, path.dirname(fromRel), spec));
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
};
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Lines (1-based) of a vendored file's leading comment block, which may say where the file came from. */
export function headerLines(text) {
  const out = new Set();
  let block = false;
  for (const [i, line] of text.split('\n').entries()) {
    const t = line.trim();
    if (block) { out.add(i + 1); if (t.includes('*/')) block = false; continue; }
    if (t.startsWith('/*')) { out.add(i + 1); block = !t.includes('*/'); continue; }
    if (t.startsWith('//') || t.startsWith('#')) { out.add(i + 1); continue; }
    if (t === '') continue;
    break;
  }
  return out;
}

/** Every violation in one file: [{ rule, line, text }]. No exemptions here; scanRepo applies them. */
export function scanText(rel, text) {
  const hits = [];
  const add = (rule, index, matched) => hits.push({ rule, line: lineOf(text, index), text: matched });
  for (const { id, re } of TEXT_RULES) for (const m of text.matchAll(re)) add(id, m.index, m[0]);

  if (/\.ya?ml$/.test(rel)) {
    for (const m of text.matchAll(/^[ \t]*external[ \t]*:(?![ \t]*(?:false|no)\b).*$/gim)) add('external-docker-network-or-volume', m.index, m[0].trim());
  }
  if (isCompose(rel)) {
    for (const m of text.matchAll(/(?:^|[\s:'"-])(\.\.(?:\/[^\s'":]*)?)(?=[\s:'"]|$)/gm)) if (leaves(rel, m[1])) add('compose-path-leaves-repo', m.index, m[1]);
  }
  if (isDockerfile(rel)) {
    const stages = new Set(); // names and numbers of the stages built so far in this file
    let built = 0;
    for (const [i, raw] of text.split('\n').entries()) {
      const line = raw.trim();
      if (line.startsWith('#')) continue;
      const from = line.match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
      if (from) {
        if (TEXT_RULES.some(({ re }) => new RegExp(re.source, 'i').test(from[1]))) hits.push({ rule: 'from-image-of-their-stack', line: i + 1, text: from[1] });
        stages.add(String(built++));
        if (from[2]) stages.add(from[2].toLowerCase());
        continue;
      }
      for (const m of line.matchAll(/(?:--from=|--mount=[^\s]*\bfrom=)([^\s,]+)/gi)) {
        if (!stages.has(m[1].toLowerCase())) hits.push({ rule: 'copy-from-something-not-built-here', line: i + 1, text: m[1] });
      }
    }
  }
  if (isScript(rel)) {
    const spec = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bnew URL\(\s*)(['"])([^'"\n]+)\1/g;
    for (const m of text.matchAll(spec)) if (importLeavesRepo(rel, m[2])) add('import-leaves-repo', m.index, m[2]);
  }
  if (/\.css$/.test(rel)) {
    for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"\n]+)\1/g)) if (importLeavesRepo(rel, m[2])) add('import-leaves-repo', m.index, m[2]);
  }
  if (path.basename(rel) === 'package.json') {
    let pkg = {};
    try { pkg = JSON.parse(text); } catch { /* not valid JSON: the other tests will say so */ }
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides']) {
      for (const [name, spec] of Object.entries(pkg[group] || {})) {
        if (typeof spec !== 'string') continue;
        const local = spec.match(/^(?:file|link|portal):(.*)$/);
        if (local && leaves(rel, local[1])) hits.push({ rule: 'dependency-leaves-repo', line: 1, text: `${name}: ${spec}` });
        if (SOURCE_REPO_NAME.test(spec)) hits.push({ rule: 'dependency-on-ai-demo2', line: 1, text: `${name}: ${spec}` });
      }
    }
  }
  return hits;
}

function importLeavesRepo(rel, spec) {
  if (/^(?:\/Users\/|\/home\/|~\/|file:)/.test(spec)) return true;
  return /^\.\.?(?:\/|$)/.test(spec) && leaves(rel, spec);
}

/** The lines a file may keep: prose files whole, README attribution lines, a vendored file's header comment. */
export function exemptLines(rel, text) {
  if (PROSE_FILES.has(rel)) return 'all';
  const out = new Set();
  if (rel === 'README.md') text.split('\n').forEach((l, i) => { if (README_ATTRIBUTION.test(l)) out.add(i + 1); });
  if (VENDORED.some((v) => rel === v || (v.endsWith('/') && rel.startsWith(v)))) for (const n of headerLines(text)) out.add(n);
  return out;
}

export function violationsIn(rel, text, known = KNOWN) {
  const ex = exemptLines(rel, text);
  if (ex === 'all') return [];
  return scanText(rel, text).filter((h) => !ex.has(h.line) && !known.some((k) => k.file === rel && k.text.toLowerCase() === h.text.toLowerCase()));
}

function trackedFiles() {
  try {
    if (fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()) === root) {
      return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
    }
  } catch { /* no git here (for example the Air gets only the tracked files, without .git): walk the tree instead */ }
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist', 'coverage', '.data'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

const readText = (rel) => {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null; // staged-but-deleted (git rm): nothing to scan
  const buf = fs.readFileSync(full);
  return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8'); // binary: nothing to scan
};

test('no tracked file refers to AI-DEMO2 at run time or build time', () => {
  const files = trackedFiles();
  assert.ok(files.length > 50 && files.includes('package.json') && files.includes('scripts/no-ai-demo2.test.mjs'), 'the scan sees the repo, including this test');
  const found = [];
  for (const rel of files) {
    const text = readText(rel);
    if (text === null) continue;
    for (const h of violationsIn(rel, text)) found.push(`${rel}:${h.line}  ${h.rule}  ${h.text}`);
  }
  assert.deepEqual(found, [], `Copy it into this repo instead of pointing at AI-DEMO2 (see docs/PROVENANCE.md):\n${found.join('\n')}`);
});

test('every known exception is still there, so a stale one cannot linger', () => {
  for (const k of KNOWN) {
    const text = readText(k.file) ?? '';
    assert.ok(scanText(k.file, text).some((h) => h.text.toLowerCase() === k.text.toLowerCase()), `${k.file} no longer contains ${k.text}: remove it from KNOWN (${k.why})`);
  }
});

// The detectors themselves (mutation checks), run on text built from fragments so the fixtures do not trip the scan of this file.
const q = "'";
const kw = { from: f('fr', 'om'), imp: f('imp', 'ort'), req: f('req', 'uire'), url: f('U', 'RL') };
const code = {
  from: (spec) => `${kw.imp} x ${kw.from} ${q}${spec}${q};`,
  sideEffect: (spec) => `${kw.imp} ${q}${spec}${q};`,
  dynamic: (spec) => `const m = await ${kw.imp}(${q}${spec}${q});`,
  reexport: (spec) => `export * ${kw.from} ${q}${spec}${q};`,
  require: (spec) => `const x = ${kw.req}(${q}${spec}${q});`,
  url: (spec) => `const u = new ${kw.url}(${q}${spec}${q}, ${kw.imp}.meta.url);`,
};
const rulesIn = (rel, text) => violationsIn(rel, text, []).map((h) => h.rule);

test('detects an AI-DEMO2 hostname, container, image, path and env var', () => {
  assert.deepEqual(rulesIn('a.js', `fetch("https://${f('ai-demo', '.ping-devops.com')}/api")`), ['hostname']);
  assert.deepEqual(rulesIn('a.js', `const u = "http://langchain.${f('ping', '.demo')}/x"`), ['hostname']);
  assert.deepEqual(rulesIn('a.js', `await fetch("http://${f('ai-demo', '-langchain-agent')}:8888")`), ['container-or-network-name']);
  assert.deepEqual(rulesIn('a.sh', `docker exec ${f('ai-demo', '_agent_1')} ls`), ['container-or-network-name']);
  assert.deepEqual(rulesIn('a.sh', `docker pull ${f('ghcr.io/c', 'muir_ping', 'corp')}/x:1`), ['image-or-registry']);
  assert.deepEqual(rulesIn('a.sh', `docker run ${f('ai-demo2', '-ui')}:1`), ['image-or-registry']);
  assert.deepEqual(rulesIn('a.sh', `cd ~/${f('Development/', 'AI-DEMO2')}`), ['checkout-path']);
  assert.deepEqual(rulesIn('a.md', `see ${f('/', 'AI-DEMO2', '/')}demo_api_ui`), ['checkout-path']);
  assert.deepEqual(rulesIn('a.js', `process.env.${f('AI_DEMO2', '_TOKEN')}`), ['env-var']);
});

test('does not flag this app, its parent repo, or plain prose', () => {
  for (const ok of ['ai-demo-standalone', 'ai-demo-standalone-LAB', 'AI-DEMO-Standalone shared/evidence', 'local.ping-devops.com:8443/ai-demo-standalone/', 'a mock of the AI-DEMO2 dashboard', 'ping.demonstrate', 'mapping.demo.example']) {
    assert.deepEqual(rulesIn('a.md', ok), [], ok);
  }
});

test('detects external Docker networks and volumes, and compose paths that leave the repo', () => {
  assert.deepEqual(rulesIn('docker-compose.yml', 'networks:\n  net:\n    external: true\n'), ['external-docker-network-or-volume']);
  assert.deepEqual(rulesIn('docker-compose.yml', 'volumes:\n  v:\n    external:\n      name: shared\n'), ['external-docker-network-or-volume']);
  assert.deepEqual(rulesIn('docker-compose.yml', 'networks:\n  net:\n    external: false\n'), []);
  assert.deepEqual(rulesIn('docker-compose.yml', 'services:\n  a:\n    volumes:\n      - ../other:/data\n'), ['compose-path-leaves-repo']);
  assert.deepEqual(rulesIn('docker-compose.yml', 'services:\n  a:\n    build:\n      context: ..\n'), ['compose-path-leaves-repo']);
  assert.deepEqual(rulesIn('docker-compose.yml', 'services:\n  a:\n    volumes:\n      - ./data:/data\n'), []);
});

test('Dockerfile: COPY --from must name a stage built in the same file; FROM must not be an AI-DEMO2 image', () => {
  assert.deepEqual(rulesIn('Dockerfile', 'FROM node:26 AS build\nRUN true\nFROM node:26\nCOPY --from=build /a /b\n'), []);
  assert.deepEqual(rulesIn('Dockerfile', 'FROM node:26\nFROM node:26\nCOPY --from=0 /a /b\n'), []);
  assert.deepEqual(rulesIn('Dockerfile', 'FROM node:26\nCOPY --from=registry.example/x:1 /a /b\n'), ['copy-from-something-not-built-here']);
  assert.deepEqual(rulesIn('Dockerfile', 'FROM node:26\nRUN --mount=type=bind,from=other,target=/x true\n'), ['copy-from-something-not-built-here']);
  assert.ok(rulesIn('Dockerfile', `FROM ${f('ghcr.io/c', 'muir_ping', 'corp')}/base:1\n`).includes('from-image-of-their-stack'));
  assert.ok(rulesIn('ui.Dockerfile', `FROM ${f('ai-demo2', '-ui')}:1 AS ui\n`).includes('from-image-of-their-stack'));
});

test('detects a relative import, URL, CSS @import or dependency that leaves the repo', () => {
  const out = '../../../elsewhere/x.js';
  for (const kind of Object.keys(code)) assert.deepEqual(rulesIn('server/src/a.js', code[kind](out)), ['import-leaves-repo'], kind);
  assert.deepEqual(rulesIn('web/src/a.css', `@${kw.imp} "../../../x.css";`), ['import-leaves-repo']);
  assert.deepEqual(rulesIn('scripts/a.mjs', code.from('/Users/someone/x.js')), ['import-leaves-repo']);
  assert.deepEqual(rulesIn('server/src/a.js', code.from('../data/x.json')), [], 'one level up from server/src stays inside the repo');
  assert.deepEqual(rulesIn('server/test/a.js', [code.from('../src/x.js'), code.from('./y.js'), code.from('express')].join(' ')), []);
  assert.deepEqual(rulesIn('package.json', JSON.stringify({ dependencies: { x: 'file:../../elsewhere/x' } })), ['dependency-leaves-repo']);
  assert.deepEqual(rulesIn('package.json', JSON.stringify({ dependencies: { x: `github:someone/${f('AI-DEMO', '2')}` } })), ['dependency-on-ai-demo2']);
  assert.deepEqual(rulesIn('web/package.json', JSON.stringify({ dependencies: { x: 'file:../server' } })), []);
});

test('exemptions are narrow: prose files, README attribution lines, a vendored header comment, and nothing else', () => {
  const bad = `see ${f('/', 'AI-DEMO2', '/')}x`;
  assert.deepEqual(rulesIn('docs/PROVENANCE.md', bad), []);
  assert.deepEqual(rulesIn('CHANGELOG.md', bad), []);
  assert.deepEqual(rulesIn('README.md', `Ported from ${f('/', 'AI-DEMO2', '/')}x`), []);
  assert.deepEqual(rulesIn('README.md', `- Copied from ${f('/', 'AI-DEMO2', '/')}x`), []);
  assert.deepEqual(rulesIn('README.md', `Run ${f('ai-demo', '-langchain-agent')} first`), ['container-or-network-name']);
  assert.deepEqual(rulesIn('docs/safety.md', `Ported from ${f('/', 'AI-DEMO2', '/')}x`), ['checkout-path']);
  assert.deepEqual(rulesIn('web/src/evidence/lanes.js', `// Ported from ${f('/', 'AI-DEMO2', '/')}x\n/* more ${f('/', 'AI-DEMO2', '/')}x */\nimport a from "./a";\n`), []);
  assert.deepEqual(rulesIn('web/src/evidence/lanes.js', `import a from "./a";\n// Ported from ${f('/', 'AI-DEMO2', '/')}x\n`), ['checkout-path']);
  assert.deepEqual(rulesIn('web/src/App.jsx', `// Ported from ${f('/', 'AI-DEMO2', '/')}x\n`), ['checkout-path']);
});

test('the known exceptions only cover the exact file and text', () => {
  const t = f('ai-demo', '-pf-rar');
  assert.deepEqual(violationsIn('server/data/catalog.json', `client ${t}.`).map((h) => h.rule), []);
  assert.deepEqual(violationsIn('server/src/app.js', `client ${t}.`).map((h) => h.rule), ['container-or-network-name']);
  assert.deepEqual(violationsIn('server/data/catalog.json', `client ${f('ai-demo', '-pf-rar-2')}.`).map((h) => h.rule), ['container-or-network-name']);
});
