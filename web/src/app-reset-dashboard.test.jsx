// Through the real App route: Reset drops the dashboard run panel's record (the App's own DashboardPage wrapper must forward resetSignal).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockRecord } from "./run-observability/fixtures.js";

vi.mock("./api", () => ({
  assistantTurn: vi.fn(async () => ({ ok: true, body: { reply: { by: "agent", text: "Your balance is $1,000." }, obs: { id: "run-abc123-1" } } })),
  assistantBrainInfo: vi.fn(async () => ({ ok: true, body: { available: false } })),
  assistantBrainTurn: vi.fn(),
  getJson: vi.fn(async () => ({ banner: "SIMULATED", intro: "i", scenarios: [], talkTrack: [] })),
  getRuns: vi.fn(async () => ({ workspace: "w-test", runs: [] })),
  resetWorkspace: vi.fn(async () => true),
  setMode: vi.fn(async () => ({ ok: false, status: 409, body: {} })),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
  realExchange: vi.fn(),
}));
vi.mock("./components/PolicyGate", () => ({ default: () => <section>gate</section> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
vi.mock("./components/TalkTrack", () => ({ default: () => null }));
vi.mock("./return-link/ReturnLink.jsx", () => ({ default: () => null }));
vi.mock("./pages/UseCasesPage", () => ({ default: () => <section>use cases</section> }));
import App from "./App";

const real = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = real; window.location.hash = ""; });

describe("Reset through the App's dashboard route", () => {
  it("after Reset the run panel no longer shows the last run's record", async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).startsWith("/api/runs/record")
      ? new Response(JSON.stringify({ record: mockRecord }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404 })));
    window.location.hash = "#/dashboard";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Balance read (delegated token)" }));
    await waitFor(() => expect(screen.getByTestId("ro-wrap")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("reset"));

    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("ro-wrap")).toBeNull();
  });
});
