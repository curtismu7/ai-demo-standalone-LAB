# Talk track

<!-- Generated from server/src/policyData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated: the PDP, the directory and the tokens are mock, mirroring what the AI-DEMO2 dashboard enforces.

## One engine, every track

Foundations, controls, HITL, attacks, learning — the tracks frame the same decision chain: token, gateway, policy.

## Groups on every call

Directory membership is read on EVERY decision. Flip it and the very next call moves — UC9A is the lesson.

## Tiers are bands

Standard caps at $2000, Premium at $50000, and premium-only tools are listed in policy — never implied by scopes.

## WHO is acting

act={agent} names the actor; the allow-list refuses unknown agents at the gateway, before any policy.

## What we do not claim

The mock decisions follow the enforced contract, but the values (users, groups, ceilings) are demo values. No real tenant.

## The attack gallery

The attacks track runs in-app too: wrong scope, account takeover, bad client, confused deputy, raw token forwarding, and the fail-closed outage — each refused by the same chain: token, gateway, policy.

## Close

Reset clears your workspace: directory flips and runs. Nothing was sent anywhere.

## The scenarios

1. **UC1: consent mints act={agent} — the balance read permits.** One consent, one delegated token: sub is the user, act={demo-agent} names the actor. Every action traces to a real human.
2. **UC9: not in the required group — denied regardless of scopes.** The policy reads directory groups on EVERY decision. No group, no access — the token’s scopes cannot override it.
3. **UC9A: flip the directory entry — the very next call moves.** Revoke the privileged group and the SAME call denies — no code change, no cache, no re-login.
4. **UC21: Standard tier cannot invoke the premium wire.** Positive least privilege: premium-only tools are listed in policy, never implied by scopes.
5. **UC21: promote to Premium — the tool unlocks (then HITL pauses).** Promotion first unlocks the tool (tier_tool_not_allowed is gone), then the HITL layer pauses it for approval — bands stack with groups, policy-driven, not hard-coded.
6. **UC21: $60000 exceeds even the Premium ceiling.** Tiers cap amounts: Premium ceiling $50000, Standard $2000. Amounts are policy bands, not tool arguments.
7. **UC3: the act gate — the actor is checked on every call.** The act claim is minted from the actor token at exchange, and the may_act consent is bridged to the PDP on EVERY call: a call whose acting agent does not match the consent is denied, and revoking the consent takes effect without waiting for the delegated token to expire.
8. **UC6: an unknown agent is refused at the gateway.** Authorization keys on WHO is acting: the actor allow-list refuses an unregistered agent before any policy runs.
9. **UC32: a token aimed at an upstream MCP is refused.** An audience is a destination: a token minted for an upstream MCP server is never accepted downstream.
10. **UC19: the live agent identity — the exchange succeeds.** This is the registered, live agent app: its credential mints the delegated token and the call proceeds. Retire or rotate that app in the PingOne console and the SAME call dies at the exchange step — one lifecycle action, no per-tool cleanup anywhere.
11. **UC20: observability — the full trace is reconstructable.** Every hop is logged with the traceId and the act chain: sign-in, exchange, the Authorize decision, the tool dispatch. Who the agent was, who authorized it, what it did, what the policy decided — the full audit trail rebuilds from the evidence panels, no app-layer instrumentation.
12. **UC33: My mortgage — the proof travels with every tool.** The identical RFC 8693 chain (sub is the human, act={demo-agent}) authorizes a mortgage lookup, not just the everyday balance read: delegated-access proof is not special-cased per tool, so the attribution coverage does not shrink as the tool surface grows.
13. **UC34: Spot unusual patterns — reasoning rides the same rails.** Free-form reasoning is not a shortcut: the agent decides WHAT to look at (the recent-activity read), but every underlying call still runs the same token-exchange, gateway and Authorize legs as a deterministic chip. Unusual patterns surface through the same governed pipeline.
14. **UC35: Why was that blocked? — the explanation reads the run.** The agent narrates the REAL events of the run — the act chain, the group gate, the Authorize verdict — not a canned script. The explanation is only as good as the evidence the chain produced, so it cannot drift from what actually fired.
15. **UC7: MFA step-up — the agent pauses, the human completes MFA.** From $500 up: consent + MFA (the tier ceiling, $2000 Standard and $50000 Premium, still denies first). The agent PAUSES — it cannot self-approve. The receipt (MfaVerified) re-evaluates the SAME call.
16. **UC5: wrong scope — a read-scoped token calling a write tool is refused.** Scope enforcement is cold: the token says read, the tool needs write — 403 insufficient_scope at the gateway before any tool runs. Read cannot become write no matter how the call is framed.
17. **UC10: account takeover — reading another user’s account is denied.** Authorization includes WHICH resource, not just WHICH action: the policy binds the resource to the token subject and denies the cross-owner call even with valid scopes and a clean act chain. Ownership decides.
18. **UC11: bad client — a token minted for another API is refused 401.** Token validation comes first: aud/exp/iss/nbf are checked before any routing, so a token minted for audience X is worthless at audience Y. An audience is a destination.
19. **UC13: confused deputy — a forged actor header cannot change who acts.** Actor identity comes from the native act claim minted at the exchange — never from a header. The injected X-Acting-For: demo-agent is ignored; the allow-list sees the real actor and refuses an unregistered one.
20. **UC16b: raw user-token forwarding — the BFF refuses to hand your token to a tool.** Zero Trust at the source: the user’s raw token never crosses to the agent runtime or a tool — only exchanged, agent-scoped tokens with an act claim leave the BFF. The forwarding attempt is blocked before the gateway.
21. **UC29: token-validation outage — the gateway fails closed.** Token validation is on the request path for EVERY call: when the validation backend cannot be reached the gateway refuses with a 503 rather than letting traffic through. An outage degrades to deny, never to allow.
22. **UC8: HITL approval — an approval is never an MFA.** Human-approval tools always pause the agent, whatever the amount. Only a verified, call-bound HitlApproved receipt moves it.
23. **UC22: CIBA — out-of-band approval on the user’s device.** An agent has no browser in which to prompt: the backend calls bc-authorize and the user approves out-of-band; the receipt (CibaApproved) re-evaluates the call.
