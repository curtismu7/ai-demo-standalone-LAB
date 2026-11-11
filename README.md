# AI Demo Standalone

Tier: Demo.
Repo: https://github.com/curtismu7/ai-demo-standalone-LAB
Catalog id: D128. Port: 7810.

A mock of the AI-DEMO2 dashboard as one standalone app. It carries the dashboard's whole use-case catalog (87 use cases in 8 tracks) and runs them against one mock policy decision point (PDP). Nothing calls a real identity provider, gateway or tenant: the PDP, the directory and every token are mock values, labelled as such.

## What it does today

One decision engine answers every wired use case. A call is checked in four stages, in order (`server/src/pdp.js`, `hitl.js`):

1. **Token.** `sub` present, not expired, `aud` is this app's audience. A missing bearer is a real `401` with `WWW-Authenticate`, before anything else.
2. **Gateway.** The `act` chain is validated: the actor must be on the actor allow-list (`demo-agent`), and a token whose audience names an upstream MCP server (`mcp-weather.internal`, `mcp-portfolio.internal`) is refused.
3. **Policy.** The directory is read on EVERY decision. The user must be in the `privileged` group (regardless of the token's scopes); the premium-only tools (`create_wire_transfer`, `approve_large_transfer`) need the `premiumTier` group; the amount must fit the tier ceiling (Standard $2000, Premium $50000).
4. **Obligation layer (HITL).** A call the policy would permit can still be PAUSED instead of decided. Amount bands and approval tools return an OBLIGATION (HTTP `202`), not a denial: the agent pauses, a human resolves a challenge, and a receipt re-evaluates the same call. Details in the next section.

Each answer carries the teaching layer: a per-stage narrative, a one-sentence lesson, which Ping product plays which role (PingFederate as IdP, PingGateway as gateway, PingOne Authorize as PDP, all stand-ins), and the "tech proof": mock request and response text for every hop with a W3C `traceparent`.

### HITL obligations (UC7, UC8, UC22)

| Obligation | Raised by | The human must | The receipt carries |
| --- | --- | --- | --- |
| `CONFIRM` | amount >= $250 | consent (no MFA at this band) | `ConsentGiven: true`, `MfaVerified: false` |
| `STEP_UP` | amount >= $500 | consent and MFA (the mock OTP is `123123`) | `ConsentGiven: true`, `MfaVerified: true` |
| `HITL_CONSENT` | the tools `create_transfer`, `create_wire_transfer`, `approve_large_transfer`, at any amount | consent. An approval is never an MFA | `HitlApproved: true` |
| `CIBA` | the tool `move_money` (an agent-initiated action with no browser) | approve out-of-band on their device (mock `auth_req_id`) | `CibaApproved: true` |

**Challenges and receipts are issued by the server.** `POST /api/challenge` stores the challenge in the workspace; `POST /api/challenge/answer` looks it up by `challengeId` and checks the answer against the stored copy (editing `needs` or the band in transit changes nothing; a challenge the server never issued answers `challenge_unknown`). A challenge lasts 5 minutes and can be answered once (`challenge_spent`). Answering issues a receipt into the same per-workspace store (bounded, 5-minute TTL) bound to the user, the tool, the obligation and the amount: `HitlApproved`, `CibaApproved`, or `ConsentGiven` with `MfaVerified`. `MfaVerified` is `true` only on a STEP_UP receipt, after the OTP was verified; a CONFIRM receipt carries `MfaVerified: false`.

Presenting a receipt to `POST /api/authorize` in `receipt` re-evaluates the SAME call to `PERMIT` and **consumes** it: a receipt permits one call. The server looks the receipt up by `receiptId` and compares the call with what it stored, never with the copy in the request. A receipt that was not issued in this workspace, is already spent, is older than 5 minutes, or does not match the call's user, tool, amount (a missing amount only matches a missing amount) or obligation leaves the call paused: the answer is still `202` `OBLIGATION` (an obligation is a pause, never a denial), and `receiptCheck` in the response names the refusal (`receipt_not_found`, `receipt_spent`, `receipt_expired`, `receipt_user_mismatch`, `receipt_tool_mismatch`, `receipt_amount_mismatch`, `receipt_obligation_mismatch`). A refused attempt does not burn a genuine receipt. Reset clears the workspace's challenges and receipts.

The bands are checked after the policy, and there is no separate hard-deny band above them: the tier ceilings ($2000 Standard, $50000 Premium) are the hard limits, and the policy denies before the obligation layer runs.

### A2A hand-off (UC2, UC2.5, UC2.6, UC2.7)

Two chained RFC 8693 exchanges build a nested act chain: exchange #1 makes the generalist agent act for the user (`act={generalist}`), exchange #2 hands off to a specialist (`act={specialist, act:{generalist}}`) with the scope narrowed to what the generalist held (UC2, UC2.5). The A2A gateway routes the call only when the SPECIALIST is in the Agent Card registry (seeded: `portfolio-specialist`, `wire-specialist`; UC2.6, and you can register or revoke one live per workspace). A plain `act={agent}` token is refused (`chain_not_nested`), a token without the scope is refused (`scope_narrowed_away`), and a call with no bearer is a real `401` (UC2.7). The web page has an A2A panel for this; it is not one of the scenario chips.

### What is wired, and what is not

Stage 2 is shipped. **Wired:** the foundations and controls scenarios, HITL (UC7, UC8, UC22) and the A2A hand-off (UC2, UC2.5, UC2.6, UC2.7). **Not wired:** the **attacks** (11), **learn** (23), **tools** (8), **nhi** (2) and **demo** (8) tracks are catalog entries only: each has its one-liner, buyer story, business value, product roles and expected outcome from the dashboard's own config, and the app does not run them. Use cases in foundations, controls and hitl that are not one of the scenarios below, or the A2A panel, are catalog entries too.

| Track | Use cases |
| --- | --- |
| foundations | 15 |
| learn | 23 |
| controls | 16 |
| hitl | 4 |
| demo | 8 |
| attacks | 11 |
| tools | 8 |
| nhi | 2 |

**Real is reserved.** The Mock / Real toggle follows rule 19 (`POST /api/mode` with exactly `{ "source": "mock" | "real" }`, `409` when Real is not configured), and `GET /api/info` reports `realAvailable` when `AIDEMOLAB_REAL_URL`, `AIDEMOLAB_REAL_CLIENT_ID` and `AIDEMOLAB_REAL_CLIENT_SECRET` are all present. This build has no live data path behind it, so Mock is the only working mode.

## Direction

This app will become a look-alike of the AI-DEMO2 `/dashboard` page, the **Customer dashboard**: account cards, a "Banking assistant" chat column and a token-chain panel, with this app's 87-use-case catalog and mock PDP behind it. The design mocks are in the AI-DEMO2 repo under `demo_api_ui/design/`: `customer-dashboard-2026.html` and `customer-dashboard-2026-agent-ui.html`. They are a read-only visual reference; nothing is imported from AI-DEMO2.

The page you see now (a catalog and run panel, with the HITL and A2A panels) is the stage-1/2 interface and will be replaced by that rebuild. The server, the PDP, the HITL and A2A engines, the catalog and the API below stay.

## The eleven live scenarios

| # | Use case | Track | Result | What it teaches |
| --- | --- | --- | --- | --- |
| 1 | UC1 consent mints `act={agent}`; the balance read permits | foundations | PERMIT | One consent, one delegated token: `sub` is the user, `act` names the actor |
| 2 | UC9 not in the required group | controls | DENY (policy) | Groups are read on every decision; scopes cannot override them |
| 3 | UC9A flip the directory entry | controls | DENY (policy) | Revoke `privileged` and the SAME call denies, with no code change |
| 4 | UC21 Standard tier cannot invoke the premium wire | controls | DENY (policy) | Premium-only tools are listed in policy, never implied by scopes |
| 5 | UC21 promote to Premium | controls | OBLIGATION `HITL_CONSENT` | The tool unlocks, then the HITL layer pauses it: bands stack with groups |
| 6 | UC21 $60000 exceeds even the Premium ceiling | controls | DENY (policy) | Tiers cap amounts |
| 7 | UC6 an unknown agent is refused at the gateway | foundations | DENY (gateway) | The actor allow-list runs before any policy |
| 8 | UC32 a token aimed at an upstream MCP is refused | controls | DENY (gateway) | An audience is a destination |
| 9 | UC7 MFA step-up ($600) | hitl | OBLIGATION `STEP_UP` | The agent pauses; the human completes MFA; the receipt re-evaluates the call |
| 10 | UC8 HITL approval (`create_transfer`, $100) | hitl | OBLIGATION `HITL_CONSENT` | Approval tools always pause; an approval is never an MFA |
| 11 | UC22 CIBA (`move_money`) | hitl | OBLIGATION `CIBA` | An agent has no browser: approval happens out-of-band on the user's device |

The seeded directory has three users: `demoUser` (`privileged`, Standard), `premiumUser` (`privileged`, `premiumTier`, Premium) and `jane` (no groups, Standard). Three vertical packs (`retail`, `health`, `finance`) change the brand wording only.

## Run it

- `./scripts/run.sh`: host-run on port 7810 (Node >= 26), installs and builds if needed, runs the doctor, starts the server.
- Docker (OrbStack): `HOST_PORT=7810 docker compose up --build -d`, published on `127.0.0.1` only.
- Through the shared lab-proxy: `https://local.ping-devops.com:8443/ai-demo-standalone/`.
- Tests: `npm ci && npm test && npm run build`. Real counts from a run after the receipt fixes, 2026-11-10 (Node 26): **65 server tests, 25 web tests (3 files) and 19 root packaging tests, 109 in all**, all passing.

## Run from a clone

Prerequisites: Node 26 or newer. Docker (OrbStack) only if you use the Docker form. Mock needs no tenant, credentials or settings.

```
git clone https://github.com/curtismu7/ai-demo-standalone-LAB.git
cd ai-demo-standalone-LAB
npm ci
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7810/ (the server serves the built page). `GET /api/health` answers `demo-health/1`.

## Ports, and what to do if the port is taken

ai-demo-standalone-LAB has ONE port, **7810**, taken from the packed range 7800-7999 (it first used 7710, which diagram-prove-lab already holds). The server refuses any other port on purpose (`npm run doctor` says so), and Docker publishes it on `127.0.0.1:7810` only.

If 7810 is taken:

1. Find what is using it: `lsof -iTCP:7810 -sTCP:LISTEN -n -P`.
2. If it is an old copy of this app (`npm start`), stop that process: `kill <PID>`. If it is this app's container, run `docker compose down` from this folder.
3. Otherwise stop the other process, or free the port, then start again with `npm start` or `docker compose up -d`.

## API

All under `/api`. Writes are same-origin only; every request carries a workspace id in the `X-Workspace` header (lower-case letters, digits and `-`, up to 40; default `default`), and Reset clears only that workspace (directory flips, runs, challenges and receipts, the specialist registry).

| Route | What it does |
| --- | --- |
| `GET /api/health` | `demo-health/1`, GET only |
| `GET /api/info` | `mode`, `source`, `simulated`, `hosted`, `realAvailable` |
| `POST /api/mode` | Rule 19 toggle, body exactly `{ "source": "mock" \| "real" }`; `409` when Real is not configured |
| `GET /api/scenarios?vertical=` | The story as data: banner, intro, rule, the eleven scenarios, tools, facts, talk track |
| `GET /api/catalog?track=` | The 87-use-case catalog (`count`, `tracks`, `useCases`), optionally one track |
| `GET /api/diagram?name=` | The decision-chain diagram (diagram-studio/1 data) |
| `GET /api/directory` | This workspace's directory (groups and tier per user), read on every decision |
| `POST /api/directory/set` | Set one user's `groups` (up to 8) and `tier` (`Standard` or `Premium`) |
| `POST /api/consent` | Mock consent: mint a delegated token (`sub` = user, `act` = `{ sub: actor }`, 1 hour) |
| `POST /api/authorize` | The gated call: `{ token, tool, amount?, aud?, ucId?, receipt? }`. `200` PERMIT, `202` OBLIGATION (`obligation` names which), `403` DENY, `401` no bearer (with `WWW-Authenticate`); all return the decision, narrative, lesson, products, hops and trace id. A presented `receipt` is checked against the workspace's store and consumed when it permits; `receiptCheck` (`{ valid, code, reason }`, or `null` with no receipt) says why a receipt was refused |
| `POST /api/challenge` | Raise the challenge for a call that came back OBLIGATION: `{ user, tool, amount? }` returns the challenge (`needs`, 5-minute expiry, `authReqId` for CIBA); the server keeps it |
| `POST /api/challenge/answer` | The human's answer: `{ challenge, answer: { consent?, otp?, cibaApproved? } }` looks `challenge.challengeId` up and returns a receipt bound to the stored call; a challenge can be answered once (`challenge_spent`); one the server never issued is `challenge_unknown` |
| `GET /api/a2a/agent-card` | The generalist's Agent Card (mock A2A well-known document) |
| `POST /api/a2a/exchange/one` | RFC 8693 exchange #1: `{ user, generalist?, scope? }` returns the generalist token |
| `POST /api/a2a/exchange/two` | Exchange #2: `{ generalistToken, specialist?, scope? }` returns the nested-act token, scope narrowed |
| `POST /api/a2a/tool` | The specialist call: `{ token }`. `200` PERMIT, `403` DENY (`unregistered_specialist`, `chain_not_nested`, `scope_narrowed_away`, ...), `401` no bearer |
| `GET /api/a2a/registry` | The specialists registered in this workspace |
| `POST /api/a2a/registry/set` | `{ specialist, registered }`: register or revoke one; the next call moves |
| `GET /api/runs` | This workspace's last 20 runs |
| `POST /api/reset` | Clear this workspace's directory flips, runs, challenges and registry |
| `GET /shelf` | The shelf URL, if one is configured. Mounted at `/shelf`, not under `/api` (see Known gaps) |

The web page has three tabs (Dashboard & catalog, Diagram, Talk track), a Mock / Real toggle, a vertical picker, Reset and presenter mode (`P`). Opened from Customer Agent LAB with `?from=customer-agent&uc=<id>`, it preselects the matching scenario and shows a Back link.

## Known gaps

- **Receipts are a teaching mechanism, not a security boundary.** The server issues and consumes them, but a receipt is an unsigned record that anyone who knows its `receiptId` can present; the workspace id (`X-Workspace`) is not authenticated, so whoever sends it shares that workspace's store; `POST /api/consent` mints a mock token for any user without a login; and the store lives in process memory (a restart clears it). `POST /api/challenge` does not run the policy, so a challenge can be raised for a call the policy would deny (for example a user outside the group, or an amount above the tier ceiling): the receipt cannot permit what the policy denies, but the challenge is not refused up front.
- **Some page text still describes the stage-1 build:** the intro, the "stages" fact and the catalog hint say HITL and the other tracks "land in the next stages", and the use-case detail says HITL runs in "stage 2-4". HITL and A2A are wired now; that text is out of date.
- **The header's Shelf link never shows.** The page asks `GET /api/shelf`, but the server mounts the route at `/shelf`, so the page gets a 404.
- **Leftovers from the scaffold, unused:** the `k8s/` manifests and the `AIDEMOLAB_HOSTED` / hosted-banner wording belong to the SE mock build, which is deferred and not allowed for standalone apps (no hosted mode). They are not part of this app's ship form (local Docker only).
- **The UI does not follow the family UI standard** (dark shell-bar header, simulation banner first, card grid). The rebuild in "Direction" replaces the page, so the standard is applied there.
- **`server/src/shelfLink.js` still reads `SHELF_URL` from `~/Development/.env`** when the variable is not set in the environment; the compose file sets `SHELF_URL`, so the Docker form does not depend on it.

## Safety

Loopback Host check (plus `LAB_ALLOWED_HOSTS` behind the lab-proxy), same-origin writes, zero outbound network (netguard, with a self-test and a test that asserts zero attempts), 8 KB bodies, `nosniff`, read-only container filesystem, non-root, `127.0.0.1`-only publish pinned by a test. Every decision value, token, challenge, receipt and the demo OTP (`123123`) is a labelled mock value. See `docs/safety.md` and `docs/talk-track.md` (generated from the same data the UI reads).

## Attribution

The scaffold (workspaces, safety, doctor, netguard, return-link, diagram components) was copied from sibling -LAB repos of this family (mcp-gateway-lab-LAB and hitl-mfa-lab-LAB); the PDP, data and UI are this lab's own. The catalog (`server/data/catalog.json`) was extracted on 2026-11-11 from the AI-DEMO2 dashboard's `useCases.js` config as read-only shapes; the mock decisions live here. The HITL and A2A engines follow the shapes of the sibling HITL and A2A labs (shapes only). No cross-repo imports.
