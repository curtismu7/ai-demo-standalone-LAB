import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PolicyGate, { A2aPanel, CatalogList, Hops, ObligationPanel, UseCaseDetail, Verdict, useCaseFacts } from "./PolicyGate";

vi.mock("../api", () => ({
  authorize: vi.fn(),
  consent: vi.fn(),
  challenge: vi.fn(),
  answerChallenge: vi.fn(),
  a2aExchangeOne: vi.fn(),
  a2aExchangeTwo: vi.fn(),
  a2aTool: vi.fn(),
  a2aRegistry: vi.fn(async () => ({ specialists: ["portfolio-specialist", "wire-specialist"] })),
  a2aRegistrySet: vi.fn(),
  getCatalog: vi.fn(async () => ({
    count: 87, tracks: ["foundations", "controls", "attacks"],
    useCases: [
      { id: "UC1", track: "foundations", title: "Delegated access (consent only)", expectedOutcome: "PERMIT" },
      { id: "UC4", track: "attacks", title: "Stolen token replay", expectedOutcome: "DENY" },
      { id: "UC9", track: "controls", title: "Group entitlement gate", expectedOutcome: "DENY" },
    ],
  })),
  getDirectory: vi.fn(async () => ({ directory: { demoUser: { groups: ["privileged"], tier: "Standard" }, jane: { groups: [], tier: "Standard" } } })),
  setDirectory: vi.fn(async (p) => ({ ok: true, body: p })),
}));

import { authorize, consent } from "../api";

const STORY = {
  tokenLabel: "TOKEN-LABEL",
  facts: [{ id: "f1", status: "measured", text: "a fact", source: "src" }],
  scenarios: [
    { id: "uc1", ucId: "UC1", title: "UC1 consent", user: "demoUser", actor: "demo-agent", tool: "get_balance", expected: "PERMIT", lesson: "the lesson" },
    { id: "uc9", ucId: "UC9", title: "UC9 group gate", user: "jane", actor: "demo-agent", tool: "get_balance", expected: "DENY", lesson: "denied" },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe("Verdict", () => {
  it("renders the empty state, stage wording and the who line", () => {
    render(<Verdict run={null} />);
    expect(screen.getByTestId("verdict-empty")).toBeTruthy();
    render(<Verdict run={{ decision: "DENY", stage: "policy", code: "group_entitlement", reason: "not in group", user: "jane", act: { sub: "demo-agent" }, groups: [], tier: "Standard", stages: ["token: ok", "chain: ok", "policy: deny"], narrative: [{ stage: "policy", title: "The policy said no", what: "jane is in [ none ] — outside the required group." }], lesson: "Directory groups are read on EVERY decision.", products: [{ product: "PingOne Authorize", role: "PDP", does: "returned DENY" }] }} />);
    expect(screen.getByTestId("narrative").textContent).toContain("outside the required group");
    expect(screen.getByTestId("lesson-run").textContent).toContain("read on EVERY decision");
    expect(screen.getByTestId("products").textContent).toContain("PingOne Authorize");
    expect(screen.getByTestId("verdict").textContent).toContain("DENIED");
    expect(screen.getByTestId("who").textContent).toContain("demo-agent");
    expect(screen.getByTestId("who").textContent).toContain("none");
    expect(screen.getByTestId("stages").textContent).toContain("policy: deny");
  });
});

describe("Hops", () => {
  it("renders exchange hops with request/response labels and trace id", () => {
    render(<Hops hops={[{ n: 1, label: "Consent — the user approves", request: "POST /as/token.oauth2", response: "200 { act: { sub: demo-agent } }", traceparent: "00-abc-def-01" }, { n: 2, label: "The gated call", request: "POST /api/authorize", response: "403 { code: group_entitlement }", traceparent: "00-abc-ghi-01" }]} traceId="abc123" />);
    const el = screen.getByTestId("hops");
    expect(el.textContent).toContain("Tech proof");
    expect(el.textContent).toContain("trace abc123");
    expect(el.textContent).toContain("Consent");
    expect(el.textContent).toContain("403");
  });
  it("renders nothing without hops", () => {
    render(<Hops hops={[]} traceId="x" />);
    expect(screen.queryByTestId("hops")).toBeNull();
  });
});

describe("ObligationPanel", () => {
  const RUN = { decision: "OBLIGATION", obligation: "STEP_UP", user: "demoUser", act: { sub: "demo-agent" }, tool: "get_transactions", amount: 600, ucId: "UC7" };
  it("explains the pause and walks consent -> MFA -> receipt -> re-evaluate", async () => {
    const user = userEvent.setup();
    const { challenge, answerChallenge, consent, authorize } = await import("../api");
    challenge.mockResolvedValue({ ok: true, body: { challenge: { challengeId: "chg_1", obligation: "STEP_UP", user: "demoUser", tool: "get_transactions", amount: 600, needs: ["consent", "mfa"] } } });
    answerChallenge.mockResolvedValue({ ok: true, body: { receipt: { receiptId: "rcp_1234567890abcdef", challengeId: "chg_1", obligation: "STEP_UP", user: "demoUser", tool: "get_transactions", amount: 600, claims: { MfaVerified: true, ConsentGiven: true } } } });
    consent.mockResolvedValue({ ok: true, body: { token: { sub: "demoUser", act: { sub: "demo-agent" } } } });
    authorize.mockResolvedValue({ ok: true, status: 200, body: { decision: "PERMIT", stage: "policy", user: "demoUser", act: { sub: "demo-agent" }, groups: ["privileged"], tier: "Standard", stages: [], obligation: null } });
    const onResolved = vi.fn();
    render(<ObligationPanel run={RUN} onResolved={onResolved} />);
    expect(screen.getByTestId("obligation-panel").textContent).toContain("cannot self-approve");
    await user.click(screen.getByTestId("ob-raise"));
    await user.click(screen.getByTestId("ob-mfa"));
    await waitFor(() => expect(screen.getByTestId("ob-receipt").textContent).toContain("MfaVerified=true"));
    expect(answerChallenge).toHaveBeenCalledWith(expect.objectContaining({ answer: { consent: true, otp: "123123" } }));
    await user.click(screen.getByTestId("ob-rerun"));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ receipt: expect.objectContaining({ claims: { MfaVerified: true, ConsentGiven: true } }) }));
  });
  it("renders nothing when the run is not an obligation", () => {
    render(<ObligationPanel run={{ decision: "PERMIT" }} onResolved={() => {}} />);
    expect(screen.queryByTestId("obligation-panel")).toBeNull();
  });
});

describe("A2aPanel", () => {
  it("builds the chain across two exchanges and shows the decision; flips the registry", async () => {
    const user = userEvent.setup();
    const { a2aExchangeOne, a2aExchangeTwo, a2aTool, a2aRegistrySet } = await import("../api");
    a2aExchangeOne.mockResolvedValue({ token: { sub: "demoUser", act: { sub: "generalist-agent" } } });
    a2aExchangeTwo.mockResolvedValue({ token: { sub: "demoUser", act: { sub: "portfolio-specialist", act: { sub: "generalist-agent" } } } });
    a2aTool.mockResolvedValue({ ok: true, body: { decision: "PERMIT", chainDepth: 2 } });
    a2aRegistrySet.mockResolvedValue({ specialist: "rogue-specialist", registered: true, specialists: ["portfolio-specialist", "rogue-specialist"] });
    render(<A2aPanel />);
    await screen.findByTestId("a2a-panel");
    await user.click(screen.getByTestId("a2a-ex1"));
    await user.click(screen.getByTestId("a2a-ex2"));
    expect(screen.getByTestId("a2a-chain").textContent).toContain("portfolio-specialist -> generalist-agent");
    await user.click(screen.getByTestId("a2a-call"));
    await waitFor(() => expect(screen.getByTestId("a2a-result").textContent).toContain("PERMIT"));
    await user.click(screen.getByTestId("a2a-reg-add"));
    await waitFor(() => expect(a2aRegistrySet).toHaveBeenCalledWith({ specialist: "rogue-specialist", registered: true }));
  });
});

describe("CatalogList", () => {
  it("groups use cases by track and marks the selected one", () => {
    const catalog = { count: 3, useCases: [
      { id: "UC1", track: "foundations", title: "Delegated access", expectedOutcome: "PERMIT" },
      { id: "UC4", track: "attacks", title: "Stolen token", expectedOutcome: "DENY" },
    ] };
    render(<CatalogList catalog={catalog} onSelect={() => {}} selectedUc="UC1" />);
    expect(screen.getByTestId("catalog").textContent).toContain("2 tracks");
    expect(screen.getByTestId("track-foundations").textContent).toContain("UC1");
    expect(screen.getByTestId("track-attacks").textContent).toContain("UC4");
    expect(document.querySelector(".catalog-row.selected").textContent).toContain("UC1");
  });
});

describe("UseCaseDetail", () => {
  it("shows title, track, expected outcome, what-long and product roles; close works", async () => {
    const user = userEvent.setup();
    const uc = { id: "UC4", title: "Stolen token replay", track: "attacks", expectedOutcome: "DENY", maturity: "works", whatLong: "A stolen bearer token is replayed.", businessValue: "Stops replay.", buyerStory: "As a bank, I want replay stopped.", productRoles: { idp: "mints", gw: "validates", authz: "evaluates the group claim" } };
    render(<UseCaseDetail uc={uc} onClose={() => {}} />);
    expect(screen.getByTestId("uc-detail").textContent).toContain("UC4");
    expect(screen.getByTestId("ucd-what").textContent).toContain("replayed");
    expect(screen.getByTestId("ucd-roles").textContent).toContain("validates");
    expect(screen.getByTestId("ucd-roles").textContent).toContain("PingOne Authorize (PDP)");
    expect(screen.getByTestId("uc-detail").textContent).toContain("stage 2–4");
    await user.click(screen.getByTestId("ucd-close"));
  });
  it("renders nothing without a use case", () => {
    render(<UseCaseDetail uc={null} onClose={() => {}} />);
    expect(screen.queryByTestId("uc-detail")).toBeNull();
  });
});

describe("PolicyGate", () => {
  it("runs a scenario: consent mints, authorize decides, verdict shows", async () => {
    consent.mockResolvedValue({ ok: true, body: { token: { sub: "demoUser", act: { sub: "demo-agent" } } } });
    authorize.mockResolvedValue({ ok: true, status: 200, body: { decision: "PERMIT", stage: "policy", user: "demoUser", act: { sub: "demo-agent" }, groups: ["privileged"], tier: "Standard", stages: ["token: ok"], narrative: [{ stage: "policy", title: "checked", what: "three things" }], lesson: "the lesson", hops: [{ n: 1, label: "Consent", request: "r", response: "s", traceparent: "00-a-b-01" }], traceId: "tid", products: [{ product: "PingOne Authorize", role: "PDP", does: "returned DENY" }] } });
    render(<PolicyGate story={STORY} resetSignal={0} requestedId={null} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toContain("PERMITTED"));
    expect(consent).toHaveBeenCalledWith({ user: "demoUser", actor: "demo-agent", aud: undefined });
    expect(authorize).toHaveBeenCalled();
    await screen.findByTestId("catalog");
  });

  it("UC9 shows the group-entitlement DENY", async () => {
    consent.mockResolvedValue({ ok: true, body: { token: { sub: "jane", act: { sub: "demo-agent" } } } });
    authorize.mockResolvedValue({ ok: false, status: 403, body: { decision: "DENY", stage: "policy", code: "group_entitlement", reason: "regardless of the token's scopes", user: "jane", act: { sub: "demo-agent" }, groups: [], tier: "Standard", stages: [] } });
    render(<PolicyGate story={STORY} resetSignal={0} requestedId="uc9" onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toContain("DENIED"));
    expect(screen.getByTestId("verdict").textContent).toContain("regardless of the token");
  });

  it("directory board flips the privileged group", async () => {
    const user = userEvent.setup();
    const { setDirectory } = await import("../api");
    render(<PolicyGate story={STORY} resetSignal={0} requestedId={null} onSelect={() => {}} />);
    await screen.findByTestId("directory-board");
    await user.click(screen.getByTestId("flip-out"));
    await waitFor(() => expect(setDirectory).toHaveBeenCalledWith(expect.objectContaining({ user: "demoUser", groups: [] })));
    await waitFor(() => expect(screen.getByTestId("dir-msg").textContent).toContain("no groups"));
  });

  it("useCaseFacts maps catalog data to the fact shape with owasp and solution", () => {
    const uc = { id: "UC7", track: "hitl", expectedOutcome: "STEP_UP", maturity: "works", owasp: { threats: ["T10", "T3"], sections: ["§3.1.5"] }, pingOneSolution: "PingID steps up.", primaryTool: "create_transfer" };
    const facts = useCaseFacts(uc);
    expect(facts[0].text).toContain("STEP_UP");
    expect(facts.some((f) => f.id === "owasp-threats" && f.text.includes("T10"))).toBe(true);
    expect(facts.some((f) => f.id === "solution")).toBe(true);
    expect(facts.some((f) => f.id === "tool")).toBe(true);
    expect(facts.every((f) => ["measured", "inferred", "UNVERIFIED"].includes(f.status))).toBe(true);
    expect(useCaseFacts({ id: "UC1", track: "foundations", expectedOutcome: "PERMIT" }).some((f) => f.id === "runs-in" && f.text.includes("stage 1"))).toBe(true);
  });

  it("the facts panel switches to the selected use case's evidence", async () => {
    const user = userEvent.setup();
    render(<PolicyGate story={STORY} resetSignal={0} requestedId={null} onSelect={() => {}} />);
    await screen.findByTestId("catalog");
    const before = screen.getByTestId("facts").textContent;
    await user.click(screen.getByTestId("uc-UC4"));
    await waitFor(() => expect(screen.getByTestId("facts").textContent).not.toBe(before));
    expect(screen.getByText("What we know, and how well — UC4")).toBeTruthy();
  });

  it("clicking a catalog row opens the detail panel", async () => {
    const user = userEvent.setup();
    render(<PolicyGate story={STORY} resetSignal={0} requestedId={null} onSelect={() => {}} />);
    await screen.findByTestId("catalog");
    await user.click(screen.getByTestId("uc-UC4"));
    await waitFor(() => expect(screen.getByTestId("uc-detail").textContent).toContain("Stolen token replay"));
  });

  it("renders the facts with status labels and the scenario lesson", async () => {
    render(<PolicyGate story={STORY} resetSignal={0} requestedId={null} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("facts").textContent).toContain("measured"));
    expect(screen.getByTestId("lesson").textContent).toContain("the lesson");
  });
});
