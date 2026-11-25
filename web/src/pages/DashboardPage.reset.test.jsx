// Reset empties the dashboard's run panel: the last action's record is not shown after Reset (rule 27, the panel never shows a stale record).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./DashboardPage";
import { mockRecord } from "../run-observability/fixtures.js";

vi.mock("../api", () => ({
  assistantTurn: vi.fn(async () => ({ ok: true, body: { reply: { by: "agent", text: "Your balance is $1,000." }, obs: { id: "run-abc123-1" } } })),
  assistantBrainInfo: vi.fn(async () => ({ ok: true, body: { available: false } })),
  assistantBrainTurn: vi.fn(),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
  realExchange: vi.fn(),
}));

const STORY = { scenarios: [{ id: "uc1", ucId: "UC1" }] };
const realFetch = globalThis.fetch;

afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("Reset and the run panel", () => {
  it("after Reset the panel no longer shows the last run's record", async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).startsWith("/api/runs/record")
      ? new Response(JSON.stringify({ record: mockRecord }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404 })));
    const { rerender } = render(<DashboardPage story={STORY} requestedUc="UC1" resetSignal={0} />);
    await waitFor(() => expect(screen.getByTestId("ro-wrap")).toBeInTheDocument());

    rerender(<DashboardPage story={STORY} requestedUc="UC1" resetSignal={1} />);

    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("ro-wrap")).toBeNull();
  });
});
