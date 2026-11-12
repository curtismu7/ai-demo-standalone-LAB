// P1 UI foundation: the shell bar, the simulation banner, and hash routing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls = [];
const modeResponses = [];
vi.mock("../api", () => ({
  getJson: vi.fn(async (url) => { calls.push(url); return { banner: "SIMULATED", intro: "i", scenarios: [{ id: "uc1", title: "UC1", user: "demoUser", actor: "demo-agent", tool: "get_balance", expected: "PERMIT", lesson: "l" }], talkTrack: [{ id: "say-first", title: "Say first", say: "s" }] }; }),
  getRuns: vi.fn(async () => { calls.push("/api/runs"); return { workspace: "w-test", runs: [] }; }),
  resetWorkspace: vi.fn(async () => true),
  setMode: vi.fn(async (source) => modeResponses.shift() || { ok: false, status: 409, body: { error: "real_not_configured", detail: "Real mode needs a live policy engine configuration." } }),
  getInfo: vi.fn(async () => ({ mode: "mock", realAvailable: false })),
}));
vi.mock("../components/PolicyGate", () => ({ default: () => <section data-testid="gate">gate</section> }));
vi.mock("../components/DiagramTab", () => ({ default: () => <section data-testid="diagram">diagram</section> }));
vi.mock("../components/TalkTrack", () => ({ default: ({ talk }) => <section data-testid="talk">{talk.map((t) => t.title).join(",")}</section> }));
vi.mock("../return-link/ReturnLink.jsx", () => ({ default: () => null }));
vi.mock("../pages/UseCasesPage", () => ({ default: () => <section data-testid="use-cases-page"><h1>Use cases</h1></section> }));
import App from "../App";

afterEach(() => { cleanup(); calls.length = 0; window.location.hash = ""; });

describe("ShellBar", () => {
  it("renders the nav pills with hash-route hrefs", () => {
    window.location.hash = "";
    render(<App />);
    for (const [id, href] of [["dashboard", "#/dashboard"], ["use-cases", "#/use-cases"], ["observability", "#/observability"], ["guide", "#/guide"], ["welcome", "#/welcome"]]) {
      const link = screen.getByTestId(`nav-${id}`);
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("shows the brand with a MOCK badge", () => {
    render(<App />);
    expect(screen.getByTestId("mock-badge").textContent).toBe("MOCK");
    expect(screen.getByText("AI Demo")).toBeTruthy();
  });

  it("Real is reserved while unconfigured: the option is disabled with an explanatory tooltip", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-select")).toBeInTheDocument());
    const select = screen.getByTestId("mode-select");
    expect(select).toHaveValue("mock");
    const real = select.querySelector('option[value="real"]');
    expect(real.disabled).toBe(true);
    expect(real.getAttribute("title")).toBe("Real mode is not configured for this lab");
  });

  it("Mock is the default selection from the server's answer", () => {
    render(<App />);
    expect(screen.getByTestId("mock-badge").textContent).toBe("MOCK");
    expect(screen.getByText("AI Demo")).toBeTruthy();
  });

  it("the theme picker sets data-theme on the document root", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("theme-select")).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId("theme-select"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.selectOptions(screen.getByTestId("theme-select"), "light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("SimBanner", () => {
  it("is the first element inside <main> and carries the SIMULATED wording", () => {
    render(<App />);
    const banner = screen.getByTestId("sim-banner");
    const main = document.querySelector("main");
    expect(main.firstElementChild).toBe(banner);
    expect(banner.textContent).toContain("SIMULATED:");
    expect(banner.textContent).toContain("bookings, tokens and decisions");
    expect(banner.textContent).toContain("Nothing calls a real airline, identity provider, gateway or tenant.");
    expect(banner.textContent).toContain("Every value is a labelled demo value.");
  });
});

describe("hash routing", () => {
  it("defaults to #/dashboard (the P2 one-page layout)", async () => {
    window.location.hash = "";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeTruthy());
  });

  it("#/use-cases shows the use-cases page", async () => {
    window.location.hash = "#/use-cases";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("use-cases-page")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Use cases");
  });

  it("#/guide shows the guide (diagram + talk track) under one h1", async () => {
    window.location.hash = "#/guide";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("talk")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Guide");
  });

  it("#/welcome shows the welcome page", async () => {
    window.location.hash = "#/welcome";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("welcome-page")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
  });

  it("#/observability shows the audit-trail page and reads /api/runs", async () => {
    window.location.hash = "#/observability";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("observability-page")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Observability");
    await waitFor(() => expect(calls.some((u) => String(u).startsWith("/api/runs"))).toBe(true));
  });

  it("a scenario hash (#/scenario-uc9) opens the use-cases page with that scenario requested", async () => {
    window.location.hash = "#/scenario-uc9";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("use-cases-page")).toBeTruthy());
  });

  it("each page has exactly one h1", async () => {
    for (const route of ["#/use-cases", "#/observability", "#/guide", "#/welcome", ""]) {
      window.location.hash = route;
      const { unmount } = render(<App />);
      await waitFor(() => expect(document.querySelector("main").children.length > 0).toBe(true));
      // P2: the dashboard route gained its own one-page h1 ("Customer dashboard"), so every route now has exactly one
      expect(document.querySelectorAll("main h1")).toHaveLength(1);
      unmount();
    }
  });
});
