// evidenceAdapter: turns what the engine actually produced (buildHops' raw hops + the
// exchange result) into demo-hop/1 for the vendored evidence views and token cards.
// Pure functions, no I/O — the routes call these before responding, so the UI renders
// the same shapes AI-DEMO2's TokenChainPanel does without learning a second format.

import { enrichHop, validateHop } from './vendor/hopDetail.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL('./vendor/hop-catalog.json', import.meta.url)), 'utf8'));

// Which hop of a run is which catalog kind, decided from what the run itself shows,
// plus the demo-hop/1 endpoints (from/to lanes). buildHops emits at most 5 hops in a
// fixed order; consent (the exchange) is optional. Lanes follow lanes.js: browser, bff,
// idp, gateway, mcp, agent.
const KIND_BY_N = (total, hasConsent, decision) => {
  const last = total; // the response hop is always last
  const refuse = decision === 'DENY';
  const lane = (n) => {
    if (hasConsent && n === 1) return { from: 'browser', to: 'idp' };
    if (n === last) return refuse ? { from: 'gateway', to: 'bff' } : { from: 'agent', to: 'agent' };
    if (n === last - 1 && refuse) return { from: 'gateway', to: 'bff' };
    return { from: 'bff', to: 'gateway' };
  };
  return (n) => {
    const kind = (() => {
      if (hasConsent && n === 1) return 'consent'; // the exchange where act= is minted
      if (n === last) return refuse ? 'tool-refused' : 'agent-reply';
      if (n === last - 1 && refuse) return 'tool-refused';
      return 'api-call'; // generic middle hops carry no kind-specific spec
    })();
    return { kind, ...lane(n) };
  };
};

export function toDemoHops(rawHops, { decision } = {}) {
  const kinds = KIND_BY_N(rawHops.length, rawHops.length > 1, decision);
  return rawHops.map((h) => {
    const { kind, from, to } = kinds(h.n);
    const d = enrichHop({ ...h, kind, from, to }, CATALOG, {}, { tokens: 'raw' });
    return { ...d, verdict: h.verdict || (decision === 'DENY' && d.kind === 'tool-refused' ? 'deny' : 'ok') };
  });
}

/** The delegated (exchanged) token's claims, raw: the lab's own mock mint, no secrets. */
export function tokenCardsFrom({ exchangeToken, actorToken } = {}) {
  const cards = [];
  if (exchangeToken) {
    cards.push({
      id: 'exchange', title: 'Exchanged token', role: 'carries both parties (RFC 8693)', mock: true,
      claims: exchangeToken,
      // The act diff is lab-own: the parent token had no act and a different aud/scope.
      diff: {
        added: exchangeToken.act?.sub ? ['act'] : [],
        rebound: ['aud'],
        narrowed: [],
      },
    });
  }
  if (actorToken) {
    cards.push({
      id: 'agent', title: 'Actor token', role: 'the agent identity (client_credentials)', mock: true,
      claims: actorToken,
    });
  }
  return cards;
}

/** validateHop over every hop of a run; returns [] when the whole chain is demo-hop/1. */
export function validateRun(hops) {
  return hops.flatMap((h) => validateHop(h, CATALOG, { tokens: 'raw' }).map((p) => ({ n: h.n, problem: p })));
}
