// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { uc1: ['delegation'], uc9: ['entitlement'], uc9a: ['entitlement'], 'uc21-tool': ['entitlement'], 'uc21-promote': ['entitlement', 'hitl'], 'uc21-ceiling': ['entitlement'], 'uc6-rogue': ['delegation'], 'uc32-upstream': ['delegation'], 'uc7-stepup': ['hitl'], 'uc8-hitl': ['hitl'], 'uc22-ciba': ['hitl'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'ai-demo-standalone',
    title: 'AI Demo Standalone',
    version,
    demo: { id: 'ai-demo-standalone', name: 'AI Demo Standalone', catalog: 'D122', baseUrl: 'http://localhost:7710', doctor: '/api/health', tags: ['delegation', 'a2a', 'agent', 'authorize', 'oauth', 'policy', 'mock-only'] },
    glossary: [
      { id: 'delegation', term: 'Delegated token (act claim)', definition: 'After user consent, token exchange mints a delegated token: sub is the USER, act={sub: agent} names the actor. Every action traces back to a real human.', aliases: ['token exchange', 'act claim'] },
      { id: 'entitlement', term: 'Group entitlement & tiers', definition: 'The policy reads directory groups on EVERY decision: outside the required group is denied regardless of scopes, and the premium group EXPANDS capability (restricted tools + a $50000 ceiling).', aliases: ['group gate', 'tier'] },
      { id: 'hitl', term: 'Human-in-the-loop (HITL)', definition: 'Bands and approval tools return OBLIGATIONS, not denials: the agent pauses, the human resolves a consent/MFA/CIBA challenge, and a call-bound receipt re-evaluates the SAME call. An approval is never an MFA.', aliases: ['step-up', 'CIBA', 'obligation'] },
    ],
    sources: [
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'The act claim and the delegated-token shape behind the whole catalog.', status: 'not-read', checked: '2026-11-08' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-directory', label: 'Flip the directory live', description: 'Revoke the privileged group live; the SAME call flips on the next run — groups are read on EVERY decision.', group: 'concept', action: { type: 'route', href: '/#scenario-uc9a' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
