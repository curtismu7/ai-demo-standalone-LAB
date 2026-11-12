// P7 hardening: the accessibility pass as tests.
// - the Direct dashboard run panel announces through an aria-live region; errors are role=alert
// - every control has an accessible name (chips, tiles, the transcript region, the composer)
// - the outcome chip is always the word + the colour class, never colour alone
// - the Quick Config dialog returns focus to the "Demo controls" opener on close (Esc too)
// - the jump tiles scroll conditionally on prefers-reduced-motion
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantSection, StepTiles } from "./DashboardPage";
import DashboardPage from "./DashboardPage";

vi.mock("../api", () => ({
  assistantTurn: vi.fn(async () => ({ ok: true, body: { reply: { by: "agent", text: "done" }, run: null } })),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
  realExchange: vi.fn(),
}));

const RUN = { decision: "PERMIT", code: "PERMIT", reason: "allowed", ucId: "UC1", scenarioId: "uc1" };

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("AssistantSection a11y (P7)", () => {
  it("the Direct dashboard run panel announces updates through an aria-live polite region", () => {
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    const live = screen.getByTestId("direct-run-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });
  it("the live region holds the outcome (word + reason, never colour alone)", () => {
    render(<AssistantSection transcript={[]} run={RUN} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    expect(screen.getByTestId("direct-run-live").textContent).toContain("PERMIT");
    expect(screen.getByTestId("direct-run-live").textContent).toContain("allowed");
  });
  it("a failure is a role=alert", () => {
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail="the engine refused" onChip={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("the engine refused");
  });
  it("every chip has an accessible name (its label) and the chips group is named", () => {
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    const group = screen.getByRole("group", { name: "Suggested prompts" });
    const buttons = group.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(29);
    for (const b of buttons) expect((b.getAttribute("aria-label") || b.textContent).trim().length).toBeGreaterThan(0);
  });
  it("the composer input is labelled", () => {
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    expect(screen.getByLabelText("Ask the agent")).toBeTruthy();
  });
  it("the transcript is an aria-live polite region", () => {
    render(<AssistantSection transcript={[]} run={null} onSend={() => {}} busy={false} fail={null} onChip={() => {}} />);
    expect(screen.getByTestId("transcript").getAttribute("aria-live")).toBe("polite");
  });
});

describe("StepTiles a11y (P7)", () => {
  it("each tile is a link with a text name and aria-current marks the active one", () => {
    render(<StepTiles active="evidence" idPrefix="t" />);
    const tiles = screen.getAllByRole("link");
    expect(tiles).toHaveLength(5);
    for (const t of tiles) expect(t.textContent.trim().length).toBeGreaterThan(0);
    expect(screen.getByTestId("step-evidence").getAttribute("aria-current")).toBe("step");
  });
  it("clicking a tile scrolls with behavior smooth when reduced motion is NOT preferred", () => {
    const target = document.createElement("div");
    target.id = "t-signin";
    document.body.appendChild(target);
    const calls = [];
    target.scrollIntoView = (opts) => calls.push(opts);
    window.matchMedia = vi.fn((q) => ({ matches: false, media: q }));
    render(<StepTiles active={null} idPrefix="t" />);
    fireEvent.click(screen.getByTestId("step-signin"));
    expect(calls).toEqual([{ behavior: "smooth", block: "start" }]);
    target.remove();
  });
  it("honours prefers-reduced-motion: reduce scrolls with behavior auto", () => {
    const target = document.createElement("div");
    target.id = "t-plan";
    document.body.appendChild(target);
    const calls = [];
    target.scrollIntoView = (opts) => calls.push(opts);
    window.matchMedia = vi.fn((q) => ({ matches: q.includes("prefers-reduced-motion"), media: q }));
    render(<StepTiles active={null} idPrefix="t" />);
    fireEvent.click(screen.getByTestId("step-plan"));
    expect(calls).toEqual([{ behavior: "auto", block: "start" }]);
    target.remove();
    delete window.matchMedia;
  });
});

describe("Quick Config focus return (P7)", () => {
  it("closing the dialog returns focus to the Demo controls opener (Esc and Close)", async () => {
    const user = userEvent.setup();
    render(<DashboardPage story={{ scenarios: [], talkTrack: [] }} />);
    const opener = screen.getByTestId("qc-open");
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Demo controls" });
    expect(dialog).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe("qc-open"));
  });
  it("reopening after a close keeps the opener wired (open, close by footer button, focus back)", async () => {
    const user = userEvent.setup();
    render(<DashboardPage story={{ scenarios: [], talkTrack: [] }} />);
    const opener = screen.getByTestId("qc-open");
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Demo controls" });
    const close = screen.getAllByRole("button", { name: "Close" }).pop();
    await user.click(close);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe("qc-open"));
    await user.click(opener);
    expect(await screen.findByRole("dialog", { name: "Demo controls" })).toBeTruthy();
  });
});
