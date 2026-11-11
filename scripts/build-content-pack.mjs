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
  const terms = { uc1: ['delegation'], uc9: ['entitlement'], uc9a: ['entitlement'], 'uc21-tool': ['entitlement'], 'uc21-promote': ['entitlement', 'hitl'], 'uc21-ceiling': ['entitlement'], 'uc3-actgate': ['delegation'], 'uc6-rogue': ['delegation'], 'uc32-upstream': ['delegation'], 'uc19-lifecycle': ['delegation'], 'uc20-trace': ['delegation'], 'uc33-mortgage': ['delegation'], 'uc34-patterns': ['delegation'], 'uc35-why': ['delegation'], 'uc7-stepup': ['hitl'], 'uc8-hitl': ['hitl'], 'uc22-ciba': ['hitl'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'ai-demo-standalone',
    title: 'AI Demo Standalone',
    version,
    demo: { id: 'ai-demo-standalone', name: 'AI Demo Standalone', catalog: 'D128', baseUrl: 'http://localhost:7810', doctor: '/api/health', tags: ['delegation', 'a2a', 'hitl', 'agent', 'authorize', 'oauth', 'policy', 'catalog', 'mock-only'] },
    glossary: [
      { id: 'delegation', term: 'Delegated token (act claim)', definition: 'After user consent, token exchange mints a delegated token: sub is the USER, act={sub: agent} names the actor. Every action traces back to a real human.', aliases: ['token exchange', 'act claim'] },
      { id: 'mock-pdp', term: 'One mock PDP behind every wired track', definition: 'A single decision engine answers every wired use case: token checks, then the gateway chain check (actor allow-list, upstream audiences), then the policy (directory groups, tier ceilings, premium-only tools), then the obligation layer (amount bands and approval tools pause the call instead of denying it). The catalog tracks are framing over the same contract; all values are mock.', aliases: ['PDP', 'decision chain'] },
      { id: 'entitlement', term: 'Group entitlement & tiers', definition: 'The policy reads directory groups on EVERY decision: outside the required group is denied regardless of scopes, and the premium group EXPANDS capability (restricted tools + a $50000 ceiling).', aliases: ['group gate', 'tier'] },
      { id: 'hitl', term: 'Human-in-the-loop (HITL)', definition: 'Bands and approval tools return OBLIGATIONS, not denials: the agent pauses, the human resolves a consent/MFA/CIBA challenge, and a call-bound receipt, issued by the server and good for one call, re-evaluates the SAME call. An approval is never an MFA.', aliases: ['step-up', 'CIBA', 'obligation'] },
      { id: 'a2a-handoff', term: 'A2A hand-off (nested act chain)', definition: 'Two RFC 8693 exchanges: the user consents and the generalist agent acts for them, then the generalist hands off and the specialist acts via it, so the token carries act={specialist, act:{generalist}} with the scope narrowed at each hop. The gateway routes the call only when the SPECIALIST is in the Agent Card registry; no bearer at all is a real 401.', aliases: ['nested act', 'agent hand-off', 'Agent Card registry'] },
    ],
    sources: [
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'The act claim and the delegated-token shape behind the whole catalog.', status: 'not-read', checked: '2026-11-08' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-catalog', label: 'Browse the 87-use-case catalog', description: 'Every use case from the AI-DEMO2 dashboard, grouped by track. The foundations, controls and HITL scenarios and the A2A panel run against the mock PDP; the attacks, learn, tools, nhi and demo tracks are catalog entries with their expected outcome, not yet wired.', group: 'concept', action: { type: 'route', href: '/#gate' }, terms: ['mock-pdp'] },
      { id: 'concept-a2a', label: 'Build the A2A hand-off chain', description: 'Two exchanges build act={specialist, act:{generalist}} with the scope narrowed per hop (UC2, UC2.5); register or revoke a specialist and the next call moves (UC2.6); no bearer is a real 401 (UC2.7).', group: 'concept', action: { type: 'route', href: '/#gate' }, terms: ['a2a-handoff', 'delegation'] },
      { id: 'concept-directory', label: 'Flip the directory live', description: 'Revoke the privileged group live; the SAME call flips on the next run — groups are read on EVERY decision.', group: 'concept', action: { type: 'route', href: '/#scenario-uc9a' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
