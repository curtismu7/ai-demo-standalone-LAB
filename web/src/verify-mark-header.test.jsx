// The header shows this lab's own Verified / In progress mark, read from GET /api/shelf (through the lab-proxy that call reaches the shelf,
// whose payload lists every demo with its mark). The lab's own /api/shelf answers only { shelfUrl }, so there is no mark then.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("./api", () => ({
  assistantBrainInfo: vi.fn(async () => ({ ok: true, body: { available: false } })),
  getJson: vi.fn(async () => ({ banner: "SIMULATED", intro: "i", scenarios: [], talkTrack: [] })),
  getRuns: vi.fn(async () => ({ workspace: "w-test", runs: [] })),
  resetWorkspace: vi.fn(async () => true),
  setMode: vi.fn(async () => ({ ok: false, status: 409, body: {} })),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
}));
vi.mock("./components/PolicyGate", () => ({ default: () => <section data-testid="gate">gate</section> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
vi.mock("./components/TalkTrack", () => ({ default: () => null }));
vi.mock("./return-link/ReturnLink.jsx", () => ({ default: () => null }));
vi.mock("./pages/UseCasesPage", () => ({ default: () => <section>use cases</section> }));
import App from "./App";

const real = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = real; window.location.hash = ""; });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  const calls = [];
  globalThis.fetch = vi.fn((url, init) => {
    if (url === "/api/shelf") { calls.push(url); return Promise.resolve(new Response(JSON.stringify(payload))); }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  return calls;
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark (ai-demo-standalone), with the note as its tooltip, and no other lab's", async () => {
    const calls = withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "ai-demo-standalone", verification: mark("verified", "Verified", { note: "All 31 in-app use cases run on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("All 31 in-app use cases run on the mock"));
    expect(calls).toContain("/api/shelf");
  });

  it("shows nothing when the shelf lists only its url (the lab on its own port) or has no mark for this lab", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "ai-demo-standalone", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "ai-demo-standalone", verification: { status: "none", label: "" } }] }]) {
      const calls = withShelf(payload);
      const { unmount } = render(<App />);
      await screen.findByTestId("top-menu");
      await waitFor(() => expect(calls).toContain("/api/shelf"));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
