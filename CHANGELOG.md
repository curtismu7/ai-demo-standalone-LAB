# Changelog

## Unreleased

- Receipts are issued by the server and checked against it (four verified defects in the stage-2 HITL engine, one PR):
  - A hand-written receipt that was never issued is refused (`receipt_not_found`). Before, `/api/authorize` checked only the fields of the object it was handed and permitted a forged one (HTTP 200).
  - A receipt is consumed by the call it permits (`receipt_spent` on a replay). Before, the same receipt permitted again for 5 minutes. A refused attempt does not burn it.
  - `MfaVerified` is true only on a STEP_UP receipt after a verified OTP. A CONFIRM-band receipt (consent only) now carries `MfaVerified: false`; before, both carried `true`, and the permit reason said "MfaVerified" for a CONFIRM.
  - The $100000 hard-deny band is removed from the engine, the UC7 lesson, the explanations, the README and the talk track. It never fired: the tier ceilings ($2000 Standard, $50000 Premium) deny first, and they are the effective hard limits. One edge moves: `POST /api/challenge` for an amount above $100000 used to answer 400 `no_challenge`; it now raises STEP_UP like any amount from $500 (the policy still denies the call itself).
- Two holes of the same kind had to close with them, or the fixes would be empty: a challenge is now kept by the server and answered against its stored copy (before, `POST /api/challenge/answer` trusted the challenge object in the request, so a hand-made challenge with `needs: []` minted a genuine receipt with `MfaVerified: true` and no OTP; now `challenge_unknown`), and a receipt's amount must match exactly (before, a receipt approved for $100 permitted a call with no amount, and a receipt approved with no amount permitted any amount; now `receipt_amount_mismatch`).
- `POST /api/authorize` answers a refused receipt with the same `202` OBLIGATION as before plus `receiptCheck` ({ valid, code, reason }); no route changed shape. The refused receipt's reason is appended to `reason`.
- The permit reason for a receipt now lists the stored claims (for example `MfaVerified=false, ConsentGiven=true`).
- `docs/talk-track.md` regenerated (it was missing the three HITL scenarios and carried the old UC21 promote wording); `content-pack.json` regenerated for the UC7 lesson and the HITL glossary term (receipts are single use).
- 65 server tests (17 new in `server/test/receipts.test.js`), each fix proven by a mutation run (see the pull request).

- Catalog id is D128 (it was D123 in the shelf registry, which observability-lab already holds, and D122 in this repo's own shelf entry, which is a2a-lab's). Shelf entry, content pack, README and the shelf registry now agree.
- The port moved from 7710 to 7810, taken from the packed range 7800-7999. 7710 is diagram-prove-lab's port. The server now accepts exactly one port, 7810; compose, Dockerfile, k8s manifests, doctor, CI and tests follow.
- README, CLAUDE.md, CHANGELOG, `docs/safety.md` and the shelf entry were rewritten for what the app is (stage 2). They described the HITL/MFA/CIBA lab, the A2A hand-off lab and an AgentCore governance lab that this repo was scaffolded from.
- Content pack: catalog id D128, tags now `a2a` and `hitl` as well (both are wired), glossary terms for the mock PDP, HITL and the A2A hand-off, a catalog card and an A2A card.
- The page's fallback banner (shown until the server answers) no longer describes an A2A delegation chain.
- Dev proxy default in `web/vite.config.js` points at 7810.

## Stage 2 (commit 2cd0740)

- HITL (UC7, UC8, UC22): an obligation layer after the policy. Amount bands (confirm $250, step-up $500) and approval tools (`create_transfer`, `create_wire_transfer`, `approve_large_transfer`, always) return an OBLIGATION (HTTP 202); `move_money` raises CIBA. `POST /api/challenge` and `POST /api/challenge/answer` (mock OTP 123123) mint a receipt bound to user, tool, obligation and amount; a challenge answers once; the receipt re-evaluates the same call. `decideWithObligation()` is shared by `/api/authorize` and the doctor.
- A2A (UC2, UC2.5, UC2.6, UC2.7): two chained RFC 8693 exchanges build a nested act chain with the scope narrowed per hop; the gateway routes only a registered specialist (per-workspace registry you can flip); a call with no bearer is a real 401; the Agent Card is served. Routes under `/api/a2a/`.
- Scenario UC21 "promote to Premium" now ends in a HITL pause, not a PERMIT; three scenario chips added (UC7, UC8, UC22); an obligation panel and an A2A panel in the page.
- 48 server + 25 web + 19 packaging tests.

## 0.1.0 (stage 1)

- One mock PDP (token, gateway chain, policy) behind the 87-use-case catalog extracted from the AI-DEMO2 dashboard config (8 tracks).
- Eight live scenarios for the foundations and controls tracks (UC1, UC6, UC9, UC9A, UC21 x3, UC32), a live per-workspace directory board, the teaching layer (per-stage narrative, lesson, product roles, mock hops with W3C `traceparent`), a decision-chain diagram, the talk track, presenter mode, Reset, and the rule 19 Mock / Real toggle (Real reserved).
- Doctor, `GET /api/health` (`demo-health/1`), netguard with a self-test, workspace ids, three vertical packs, Learning Hub content pack, shelf entry, Docker (OrbStack) and CI.
