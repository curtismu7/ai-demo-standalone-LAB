// Opened from Customer Agent LAB: the strip and the header button show, the mapped scenario and vertical are preselected.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { scenarioFor, verticalFor, UC_SCENARIO } from "./handoffMap";
import { SCENARIOS } from "../../server/src/policyData.js";
import { VERTICALS } from "../../server/src/cast.js";

const calls = [];
vi.mock("./api", () => ({
  getJson: vi.fn(async (url) => { calls.push(url); return url.startsWith("/api/info") ? { mode: "mock", realAvailable: false, hosted: false } : { banner: "SIMULATED", intro: "i", verticals: ["retail", "health", "finance"], scenarios: [], talkTrack: [] }; }),
  resetWorkspace: vi.fn(), setMode: vi.fn(),
}));
vi.mock("./components/PolicyGate", () => ({ default: ({ requestedId }) => <p data-testid="pg">{String(requestedId)}</p> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
vi.mock("./components/ShelfLink", () => ({ default: () => null }));
import App from "./App";

afterEach(() => { cleanup(); calls.length = 0; window.history.replaceState(null, "", "/"); });

describe("hand-off from Customer Agent LAB", () => {
  it("every mapped use case names a real scenario, every mapped vertical a real vertical", () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const s of Object.values(UC_SCENARIO)) expect(ids).toContain(s);
    for (const v of ["banking", "healthcare", "retail"]) expect(Object.keys(VERTICALS)).toContain(verticalFor({ vertical: v }));
    expect(scenarioFor({ uc: "UC37" })).toBeNull();
    expect(scenarioFor({ uc: "toString" })).toBeNull();
    expect(verticalFor({ vertical: "constructor" })).toBeNull();
  });

  it("UC9 in banking: strip + header Back, the group-gate scenario and the finance vertical are preselected", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC9&vertical=banking");
    render(<App />);
    expect(screen.getByRole("note", { name: "Opened from Customer Agent LAB" }).textContent).toContain("UC9");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(screen.getByRole("note", { name: "Opened from Customer Agent LAB" })); // banner first, strip right below
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("uc9"));
    expect(calls).toContain("/api/scenarios?vertical=finance");
  });

  it("UC37 (no matching scenario): strip only, defaults kept", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC37&vertical=retail");
    render(<App />);
    expect(screen.getByRole("note", { name: "Opened from Customer Agent LAB" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
  });

  it("no from, an unknown from or a bad id: no strip, no button, defaults", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC2", "/?from=customer-agent&uc=%3Cb%3E"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
      cleanup();
    }
    expect(calls.filter((u) => u.startsWith("/api/scenarios")).every((u) => u.endsWith("retail"))).toBe(true);
  });
});
