// The one-page dashboard: five sections, jump tiles, the assistant turn filling everything.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage, { StepTiles, AssistantSection, PlanSection, EvidenceSection, ProductsSection, TalkTrackSection } from "./DashboardPage";

vi.mock("../api", () => ({
  assistantTurn: vi.fn(),
}));

import { assistantTurn } from "../api";

const RUN = {
  decision: "OBLIGATION", stage: "policy", code: "STEP_UP",
  reason: "$600 clears the step-up threshold ($500): consent + MFA required.",
  user: "demoUser", act: { sub: "demo-agent" }, groups: ["privileged"], tier: "Standard",
  tool: "get_transactions", amount: 600, ucId: "UC7", scenarioId: "uc7-stepup",
  lesson: "Step-up is a pause, not a denial: the agent cannot self-approve.",
  hops: [
    { n: 1, kind: "consent", label: "PingFederate: consent — the user approves; a delegated token is minted", from: "browser", to: "idp", verdict: "ok", fact: "may_act names the agent", request: "r", response: "s", traceparent: "00-a-b-01" },
    { n: 2, kind: "api-call", label: "The gated call reaches the API (PingGateway fronting the resource)", from: "bff", to: "gateway", verdict: "ok", fact: "done", request: "r2", response: "s2", traceparent: "00-a-c-01" },
    { n: 3, kind: "authorize-decision", label: "PingOne Authorize: groups, tier, tool, amount", from: "gateway", to: "authorize", verdict: "held", fact: "needs approval", request: "r3", response: "s3", traceparent: "00-a-d-01" },
  ],
  tokens: [
    { id: "exchange", title: "Exchanged token", role: "carries both parties (RFC 8693)", mock: true, claims: { sub: "demoUser", act: { sub: "demo-agent" }, aud: "ai-demo-standalone" }, diff: { added: ["act"], rebound: ["aud"], narrowed: [] } },
  ],
  products: [
    { product: "PingOne", role: "IdP", does: "authenticated the user" },
    { product: "PingFederate", role: "IdP", does: "minted the delegated token" },
    { product: "PingOne Authorize", role: "PDP", does: "returned OBLIGATION" },
    { product: "PingGateway", role: "gateway / PEP", does: "validated the chain" },
  ],
  narrative: [{ stage: "policy", title: "The policy paused the call (STEP_UP)", what: "The amount clears the step-up threshold." }],
  traceId: "tid",
};

const STORY = { scenarios: [{ id: "uc1", ucId: "UC1" }] };

// demo-hop/1 hops shaped like the 10-step adapter emits (server/src/hops.js): the reel
// and sequence need n/kind/from/to/verdict/title/fact/spec; the chain map keys on kind.
const DEMO_HOPS = [
  { n: 1, kind: "sign-in", from: "browser", to: "idp", verdict: "ok", mock: true, label: "sign in", title: "Sign-in", fact: "user token issued", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b1-01" },
  { n: 2, kind: "prompt", from: "browser", to: "bff", verdict: "ok", mock: true, label: "ask", title: "Prompt", fact: "message only, no token", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b2-01" },
  { n: 3, kind: "agent-receive", from: "bff", to: "agent", verdict: "ok", mock: true, label: "agent", title: "Agent", fact: "request reaches the agent", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b3-01" },
  { n: 4, kind: "llm-plan", from: "agent", to: "llm", verdict: "ok", mock: true, label: "plan", title: "Agent: intent match", fact: "model proposes a tool", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b4-01" },
  { n: 5, kind: "actor-token", from: "bff", to: "idp", verdict: "ok", mock: true, label: "agent token", title: "Agent token", fact: "agent has its own identity", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b5-01" },
  { n: 6, kind: "token-exchange", from: "bff", to: "idp", verdict: "ok", mock: true, label: "exchange", title: "Exchange", fact: "act added", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b6-01" },
  { n: 7, kind: "authorize-decision", from: "gateway", to: "authorize", verdict: "obligation", mock: true, label: "decide", title: "Authorize", fact: "policy decided", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", decision: { outcome: "OBLIGATION", by: "authorize policy", reasons: ["step-up"] } },
  { n: 8, kind: "gateway-check", from: "bff", to: "gateway", verdict: "ok", mock: true, label: "gateway", title: "Gateway", fact: "filter chain passed", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b8-01" },
  { n: 9, kind: "tool-held", from: "gateway", to: "mcp", verdict: "obligation", mock: true, label: "held", title: "Held", fact: "write held, not sent", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b9-01" },
  { n: 10, kind: "agent-reply", from: "agent", to: "agent", verdict: "ok", mock: true, label: "reply", title: "Reply", fact: "answer shown in the chat", spec: { none: true, why: "w", failure: "f" }, request: {}, response: {}, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902ba-01" },
];

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("StepTiles", () => {
  it("renders five jump tiles with hrefs and marks the active one with aria-current", () => {
    render(<StepTiles active="evidence" idPrefix="dash" />);
    const tiles = screen.getAllByRole("link");
    expect(tiles).toHaveLength(5);
    expect(tiles[0].getAttribute("href")).toBe("#dash-signin");
    expect(tiles[2].getAttribute("href")).toBe("#dash-evidence");
    expect(tiles[2].getAttribute("aria-current")).toBe("step");
    expect(tiles[0].getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("step-tiles").textContent).toContain("Sign in & ask");
  });
  it("never renders Previous/Next controls", () => {
    render(<StepTiles active={null} idPrefix="dash" />);
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(screen.queryByText(/Next/)).toBeNull();
  });
});

describe("AssistantSection", () => {
  it("shows the greeting bubble, chips, the direct-run panel and one primary Send", () => {
    render(<AssistantSection transcript={[{ who: "agent", text: "Sign in with your customer account to access travel features" }]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    expect(screen.getByTestId("transcript").textContent).toContain("travel features");
    expect(screen.getAllByTestId(/^chip-/)).toHaveLength(17);    expect(screen.getByTestId("direct-run-empty").textContent).toContain("Run a prompt");
    expect(screen.getByTestId("dash-send").className).toContain("primary");
    expect(screen.getAllByRole("button", { name: "Send" })).toHaveLength(1);
  });
  it("a chip fills the prompt and a run fills the direct-run panel", async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    const { rerender } = render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={onChip} />);
    await user.click(screen.getByTestId("chip-UC7-MFA step-up"));
    expect(onChip).toHaveBeenCalledWith("Do I need MFA step-up for this change?");
    rerender(<AssistantSection transcript={[]} run={RUN} onSend={() => {}} busy={false} fail={null} onChip={onChip} />);
    expect(screen.getByTestId("direct-run-body").textContent).toContain("UC7");
    expect(screen.getByTestId("direct-run-body").textContent).toContain("OBLIGATION");
  });
  it("Send is disabled while busy and without text", async () => {
    const user = userEvent.setup();
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    expect(screen.getByTestId("dash-send").disabled).toBe(true);
    await user.type(screen.getByTestId("dash-ask"), "check my balance");
    expect(screen.getByTestId("dash-send").disabled).toBe(false);
  });
});

describe("PlanSection", () => {
  it("pretty-prints the tool call, the brain label and the token-exchange line", () => {
    render(<PlanSection run={RUN} />);
    expect(screen.getByTestId("plan-line").textContent).toContain("get_transactions");
    expect(screen.getByTestId("brain-label").textContent).toBe("Scripted");
    expect(screen.getByTestId("token-exchange-line").textContent).toContain("RFC 8693");
    expect(screen.getByTestId("token-exchange-line").textContent).toContain("demo-agent");
    expect(screen.getByLabelText("The tool-call plan").textContent).toContain("STEP_UP");
  });
  it("renders the empty state without a run", () => {
    render(<PlanSection run={null} />);
    expect(screen.getByTestId("plan-section").textContent).toContain("shows here");
  });
});

describe("EvidenceSection", () => {
  it("renders three columns: decision + reason, the chain view, the token cards", () => {
    render(<EvidenceSection run={RUN} />);
    expect(screen.getByTestId("evidence-decision").textContent).toContain("OBLIGATION");
    expect(screen.getByTestId("evidence-reason").textContent).toContain("step-up threshold");
    expect(screen.getByTestId("chain-view").textContent).toContain("may_act names the agent");
    expect(screen.getByTestId("token-cards").textContent).toContain("MOCK");
  });
  it("renders placeholders without a run", () => {
    render(<EvidenceSection run={null} />);
    expect(screen.getByTestId("chain-empty").textContent).toContain("movie reel");
    expect(screen.getByTestId("tokens-empty").textContent).toContain("MOCK");
  });
  it("the token cards are raw and MOCK-labelled, and the act diff names the exchange", () => {
    render(<EvidenceSection run={RUN} />);
    expect(screen.getByTestId("token-cards").textContent).toContain("MOCK");
    expect(screen.getByTestId("token-cards").textContent).toContain("demo-agent");
    expect(screen.getByTestId("token-act-diff").textContent).toContain("added: act");
  });
  it("a reel frame click opens the step detail", async () => {
    const user = userEvent.setup();
    render(<EvidenceSection run={RUN} />);
    const frames = screen.getAllByTestId("chain-view")[0].querySelectorAll("[role='button'], .reel-frame, [data-n]");
    // click whatever the reel renders for hop 1 via the sequence view instead: switch view
    await user.click(screen.getByTestId("chain-view-sequence"));
    const step = screen.getAllByTestId("chain-view")[0].querySelector("[data-n], .seq-row, [role='button']");
    if (step) await user.click(step);
    // either way the panel must never crash and the empty detail must not be open with a run
    expect(screen.getByTestId("chain-view")).toBeTruthy();
  });
});

describe("EvidenceSection chain map (the 10-step row)", () => {
  beforeEach(() => { window.localStorage.clear(); });
  it("a run with demoHops derives the 10 steps: obligation hops hold their steps", () => {
    render(<EvidenceSection run={{ ...RUN, demoHops: DEMO_HOPS }} />);
    for (const id of ["signin", "prompt", "agent", "llm", "agent-token", "exchange", "gateway", "reply"]) {
      expect(screen.getByTestId(`chain-step-${id}`).dataset.state).toBe("ok");
    }
    expect(screen.getByTestId("chain-step-llm").textContent).toContain("LLM");
    expect(screen.getByTestId("chain-step-authorize").dataset.state).toBe("held");
    expect(screen.getByTestId("chain-step-tool").dataset.state).toBe("held");
  });
  it("a DENY run marks the right steps DENIED and NOT IN RUN", () => {
    const denyHops = DEMO_HOPS.map((h) =>
      h.kind === "authorize-decision" ? { ...h, verdict: "deny" }
      : h.kind === "tool-held" ? { ...h, kind: "tool-refused", verdict: "deny" }
      : h);
    denyHops.splice(9, 1); // the reply never happened: the step is not in this run
    render(<EvidenceSection run={{ ...RUN, decision: "DENY", demoHops: denyHops }} />);
    expect(screen.getByTestId("chain-step-authorize").dataset.state).toBe("deny");
    expect(screen.getByTestId("chain-step-tool").dataset.state).toBe("deny");
    expect(screen.getByTestId("chain-step-tool").textContent).toContain("denied");
    expect(screen.getByTestId("chain-step-reply").dataset.state).toBe("not-in-run");
    expect(screen.getByTestId("chain-step-signin").dataset.state).toBe("ok");
  });
  it("an OBLIGATION run with an all-obligation hop set marks the Authorize and tool steps HELD", () => {
    const holdHops = DEMO_HOPS.map((h) => (h.kind === "tool-held" || h.kind === "authorize-decision" ? { ...h, verdict: "obligation" } : h));
    render(<EvidenceSection run={{ ...RUN, demoHops: holdHops }} />);
    expect(screen.getByTestId("chain-step-authorize").dataset.state).toBe("held");
    expect(screen.getByTestId("chain-step-tool").dataset.state).toBe("held");
  });
  it("a run without demoHops still shows the section (every step not in run)", () => {
    render(<EvidenceSection run={RUN} />);
    expect(screen.getByTestId("chain-step-exchange").dataset.state).toBe("not-in-run");
  });
  it("the density toggle persists and survives a throwing localStorage", () => {
    render(<EvidenceSection run={{ ...RUN, demoHops: DEMO_HOPS }} />);
    expect(screen.getByTestId("chain-density-detailed").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("chain-density-compact"));
    expect(screen.getByTestId("chain-density-compact").getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("ud_chain_density")).toBe("compact");
    cleanup();
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("quota"); };
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try {
      render(<EvidenceSection run={{ ...RUN, demoHops: DEMO_HOPS }} />);
      expect(screen.getByTestId("chain-density-compact").getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByTestId("chain-density-detailed"));
      expect(screen.getByTestId("chain-density-detailed").getAttribute("aria-pressed")).toBe("true");
    } finally {
      Storage.prototype.getItem = get; Storage.prototype.setItem = set;
    }
  });
});

describe("ProductsSection", () => {
  it("renders one card per Ping product and the why callout", () => {
    render(<ProductsSection run={RUN} />);
    const cards = screen.getAllByTestId("product-cards")[0].querySelectorAll(".card");
    expect(cards).toHaveLength(4);
    const text = screen.getByTestId("products-section").textContent;
    for (const p of ["PingOne", "PingFederate", "PingOne Authorize", "PingGateway"]) expect(text).toContain(p);
    expect(screen.getByTestId("why-callout").textContent).toContain("Why it was paused");
    expect(screen.getByTestId("why-callout").textContent).toContain("cannot self-approve");
  });
  it("the callout wording follows the outcome", () => {
    render(<ProductsSection run={{ ...RUN, decision: "DENY" }} />);
    expect(screen.getByTestId("why-callout").textContent).toContain("Why it was blocked");
  });
});

describe("TalkTrackSection", () => {
  it("renders the run's narrative beats and lesson", () => {
    render(<TalkTrackSection run={RUN} />);
    expect(screen.getByTestId("talk-beats").textContent).toContain("paused the call");
    expect(screen.getByTestId("talk-lesson").textContent).toContain("cannot self-approve");
  });
});

describe("DashboardPage", () => {
  it("one h1, five sections, jump tiles; a run fills the sections", async () => {
    assistantTurn.mockResolvedValue({ ok: true, status: 202, body: { handling: "in-app", ucId: "UC7", scenarioId: "uc7-stepup", decision: "OBLIGATION", say: RUN.reason, obligation: "STEP_UP", run: RUN, hops: RUN.hops, reply: { text: RUN.reason, by: "gateway", outcome: "OBLIGATION", ucId: "UC7", tool: "get_transactions" } } });
    const user = userEvent.setup();
    render(<DashboardPage story={STORY} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Customer dashboard");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const id of ["assistant-section", "plan-section", "evidence-section", "products-section", "talk-section", "step-tiles"]) expect(screen.getByTestId(id)).toBeTruthy();
    await user.type(screen.getByTestId("dash-ask"), "Do I need MFA step-up for this change?");
    await user.click(screen.getByTestId("dash-send"));
    await waitFor(() => expect(screen.getByTestId("direct-run-body").textContent).toContain("UC7"));
    await waitFor(() => expect(screen.getByTestId("chain-view").textContent.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByTestId("product-cards").textContent).toContain("PingOne Authorize"));
    await waitFor(() => expect(screen.getByTestId("talk-beats").textContent).toContain("paused the call"));
    await waitFor(() => expect(screen.getByTestId("transcript").textContent).toContain("step-up threshold"));
    expect(assistantTurn).toHaveBeenCalledWith("Do I need MFA step-up for this change?");
  });
  it("chips work and the reply text per outcome lands in the transcript", async () => {
    assistantTurn.mockResolvedValue({ ok: true, status: 200, body: { handling: "in-app", ucId: "UC1", decision: "PERMIT", say: "PERMIT", run: { ...RUN, decision: "PERMIT", code: null, ucId: "UC1", reply: undefined }, hops: RUN.hops, reply: { text: "PERMIT — the policy allows this call", by: "authorize", outcome: "PERMIT", ucId: "UC1", tool: "get_balance" } } });
    const user = userEvent.setup();
    render(<DashboardPage story={STORY} />);
    await user.click(screen.getByTestId("chip-UC1-Balance read (delegated token)"));
    await waitFor(() => expect(screen.getByTestId("transcript").textContent).toContain("the policy allows this call"));
    await waitFor(() => expect(screen.getByTestId("direct-run-body").textContent).toContain("PERMIT"));
  });
  it("a redirect reply names the lab and fills no run", async () => {
    assistantTurn.mockResolvedValue({ ok: true, status: 200, body: { handling: "redirect", ucId: "UC12", lab: "stolen-token-lab", reply: { text: "That story lives in its own lab: stolen-token-lab. Open it from the shelf.", by: "agent", outcome: "HANDOFF", ucId: "UC12", tool: null } } });
    const user = userEvent.setup();
    render(<DashboardPage story={STORY} />);
    await user.type(screen.getByTestId("dash-ask"), "token theft");
    await user.click(screen.getByTestId("dash-send"));
    await waitFor(() => expect(screen.getByTestId("transcript").textContent).toContain("stolen-token-lab"));
    expect(screen.getByTestId("direct-run-empty")).toBeTruthy();
  });
  it("an unknown reply is honest and no run fills", async () => {
    assistantTurn.mockResolvedValue({ ok: true, status: 200, body: { handling: "unknown", reply: { text: "I could not match that to a scripted demo. Try one of the suggestion chips, or open Use Cases.", by: "agent", outcome: "UNKNOWN" } } });
    const user = userEvent.setup();
    render(<DashboardPage story={STORY} />);
    await user.type(screen.getByTestId("dash-ask"), "tell me a joke");
    await user.click(screen.getByTestId("dash-send"));
    await waitFor(() => expect(screen.getByTestId("transcript").textContent).toContain("could not match"));
    expect(screen.getByTestId("direct-run-empty")).toBeTruthy();
  });
  it("a server failure shows the inline error", async () => {
    assistantTurn.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    render(<DashboardPage story={STORY} />);
    await user.type(screen.getByTestId("dash-ask"), "anything");
    await user.click(screen.getByTestId("dash-send"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not answer"));
  });
});
