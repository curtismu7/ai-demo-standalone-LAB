// Opened from Customer Agent LAB: the strip and the header button show, the mapped scenario is preselected.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { scenarioFor, UC_SCENARIO } from "./handoffMap";
import { SCENARIOS } from "../../server/src/policyData.js";

const calls = [];
vi.mock("./api", () => ({
  getJson: vi.fn(async (url) => { calls.push(url); return { banner: "SIMULATED", intro: "i", verticals: ["airline"], scenarios: [], talkTrack: [] }; }),
}));
vi.mock("./shell/ShellBar", () => ({ default: ({ children }) => <header>{children}</header> }));
vi.mock("./shell/SimBanner", () => ({ default: () => <p data-testid="banner">SIMULATED</p> }));
vi.mock("./pages/WelcomePage", () => ({ default: () => null }));
vi.mock("./pages/UseCasesPage", () => ({ default: ({ requestedId }) => <p data-testid="pg">{String(requestedId)}</p> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
import App from "./App";

afterEach(() => { cleanup(); calls.length = 0; window.history.replaceState(null, "", "/"); window.location.hash = ""; });

describe("hand-off from Customer Agent LAB", () => {
  it("every mapped use case names a real scenario", () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const s of Object.values(UC_SCENARIO)) expect(ids).toContain(s);
    expect(scenarioFor({ uc: "UC37" })).toBeNull();
    expect(scenarioFor({ uc: "toString" })).toBeNull();
  });

  it("UC9: strip + header Back, the group-gate scenario is preselected", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC9");
    window.location.hash = "#/use-cases";
    render(<App />);
    expect(screen.getByRole("note", { name: "Opened from Customer Agent LAB" }).textContent).toContain("UC9");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(screen.getByRole("note", { name: "Opened from Customer Agent LAB" })); // banner first, strip right below
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("uc9"));
  });

  it("UC37 (no matching scenario): strip only, defaults kept", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC37");
    window.location.hash = "#/use-cases";
    render(<App />);
    expect(screen.getByRole("note", { name: "Opened from Customer Agent LAB" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
  });

  it("no from, an unknown from or a bad id: no strip, no button, defaults", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC2", "/?from=customer-agent&uc=%3Cb%3E"]) {
      window.history.replaceState(null, "", q);
      window.location.hash = "#/use-cases";
      render(<App />);
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
      cleanup();
    }
    expect(calls.every((u) => u === "/api/scenarios")).toBe(true);
  });
});
