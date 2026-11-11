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

## Close

Reset clears your workspace: directory flips and runs. Nothing was sent anywhere.

## The scenarios

1. **UC1: consent mints act={agent} — the balance read permits.** One consent, one delegated token: sub is the user, act={demo-agent} names the actor. Every action traces to a real human.
2. **UC9: not in the required group — denied regardless of scopes.** The policy reads directory groups on EVERY decision. No group, no access — the token’s scopes cannot override it.
3. **UC9A: flip the directory entry — the very next call moves.** Revoke the privileged group and the SAME call denies — no code change, no cache, no re-login.
4. **UC21: Standard tier cannot invoke the premium wire.** Positive least privilege: premium-only tools are listed in policy, never implied by scopes.
5. **UC21: promote to Premium — the same call now permits.** The premiumTier group expands the tool set and raises the ceiling to $50000. Policy-driven, not hard-coded.
6. **UC21: $60000 exceeds even the Premium ceiling.** Tiers cap amounts: Premium ceiling $50000, Standard $2000. Amounts are policy bands, not tool arguments.
7. **UC6: an unknown agent is refused at the gateway.** Authorization keys on WHO is acting: the actor allow-list refuses an unregistered agent before any policy runs.
8. **UC32: a token aimed at an upstream MCP is refused.** An audience is a destination: a token minted for an upstream MCP server is never accepted downstream.
