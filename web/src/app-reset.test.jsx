// The Reset message says what Reset does on the server: this workspace's kept runs go, other workspaces are not touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./api", () => ({
  assistantBrainInfo: vi.fn(async () => ({ ok: true, body: { available: false } })),
  getJson: vi.fn(async () => ({ banner: "SIMULATED", intro: "i", scenarios: [], talkTrack: [] })),
  getRuns: vi.fn(async () => ({ workspace: "w-test", runs: [] })),
  resetWorkspace: vi.fn(async () => true),
  setMode: vi.fn(async () => ({ ok: false, status: 409, body: {} })),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
}));
vi.mock("./components/PolicyGate", () => ({ default: () => <section>gate</section> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
vi.mock("./components/TalkTrack", () => ({ default: () => null }));
vi.mock("./return-link/ReturnLink.jsx", () => ({ default: () => null }));
vi.mock("./pages/UseCasesPage", () => ({ default: () => <section>use cases</section> }));
import App from "./App";

const real = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = real; window.location.hash = ""; });

describe("Reset message", () => {
  it("says Reset clears this workspace's runs and leaves other workspaces alone", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 })));
    render(<App />);
    fireEvent.click(await screen.findByTestId("reset"));
    const msg = await waitFor(() => screen.getByText(/^Reset:/)).then((el) => el.textContent);
    expect(msg).toBe("Reset: your workspace's directory flips and kept runs are cleared; other workspaces are not changed.");
  });
});
