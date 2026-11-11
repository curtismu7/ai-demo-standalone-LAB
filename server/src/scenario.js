// The shared scenario-seeding rule: ONE function decides, for any SCENARIOS entry, what
// the directory says and which token the engine runs. /api/assistant/turn, the doctor's
// scenario check and the tests all call this, so a scenario cannot be seeded one way by
// the endpoint and another way by a test (the drift the P6 batches must never reintroduce).
import { exchange, AUDIENCE, DEFAULT_ACTORS, TOOL_REQUIRED_SCOPE } from './pdp.js';

// The directory baseline per user, mirrored in web/src/pages/DashboardPage.jsx SEEDS.
export function seedFor(sc) {
  const groups = Array.isArray(sc.flipTo) ? sc.flipTo
    : sc.user === 'premiumUser' ? ['privileged', 'premiumTier']
    : sc.user === 'jane' ? [] : ['privileged'];
  const tier = sc.user === 'premiumUser' ? 'Premium' : 'Standard';
  return { groups, tier };
}

/** The token the scenario's call rides (act = the scenario's actor; UC5 can mint a wrong
 *  scope; UC29 marks the token so the validation outage denies; UC16b marks the raw
 *  user token the agent tried to forward). */
export function tokenFor(sc, { now = Date.now } = {}) {
  if (sc.rawUserToken) {
    const raw = {
      sub: sc.user, aud: sc.aud || AUDIENCE, scope: 'openid accounts:read transfers:write profile',
      iat: Math.floor(now() / 1000), exp: Math.floor(now() / 1000) + 3600, rawUserToken: true,
    };
    if (sc.validationDown) raw.validationDown = true;
    return raw;
  }
  const t = exchange({
    userSub: sc.user,
    actorClientId: sc.actor || DEFAULT_ACTORS[0],
    aud: sc.aud || AUDIENCE,
    // UC4: the scenario can name the scope the agent ASKED for; the engine answers the
    // shortfall (insufficient_scope) or the exchange's narrowing is the lesson.
    scope: sc.scope ?? (sc.tool ? TOOL_REQUIRED_SCOPE[sc.tool] ?? 'accounts:read' : 'accounts:read transfers:write'),
    now,
  });
  if (sc.validationDown) t.validationDown = true; // UC29: the validation backend is unreachable
  return t;
}

/** The non-directory arguments of a scenario's call: the search query (UC41/UC42) and the
 *  client-sent "consent already given" flag (UC27) ride with the turn, never in the token. */
export function callArgsFor(sc) {
  return { query: typeof sc.query === 'string' ? sc.query : null, consentGiven: sc.consentGiven === true ? true : null };
}
