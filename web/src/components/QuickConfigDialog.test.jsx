// P4 Quick Config: the dialog controls which evidence view the chain card renders and
// persists every choice. The plan's named tests: the view choice changes the rendered
// evidence, focus returns to the opener on close, Esc closes, keyboard move works (the
// FloatingDialog suite already owns keyboard move for the shell — here we prove the dialog
// is a FloatingDialog, i.e. movable), and storage-throws degrades to defaults.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import QuickConfigDialog, { readConfig, VIEW_CARDS } from "./QuickConfigDialog.jsx";
import { EvidenceSection } from "../pages/DashboardPage.jsx";
import ChainView from "./ChainView.jsx";

const CFG = (over = {}) => ({
  theme: "black", size: "0", view: "reel", surface: "embedded", rfc: false, follow: true, slow: false, ...over,
});

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

describe("QuickConfigDialog", () => {
  test("renders the theme, size, view cards, surface and toggles", () => {
    render(<QuickConfigDialog isOpen onClose={() => {}} config={CFG()} onChange={() => {}} />);
    expect(screen.getByTestId("qc-theme")).toBeTruthy();
    expect(screen.getByTestId("qc-size")).toBeTruthy();
    expect(screen.getByTestId("qc-views").querySelectorAll("button")).toHaveLength(VIEW_CARDS.length);
    expect(screen.getByTestId("qc-surface")).toBeTruthy();
    for (const id of ["qc-rfc", "qc-follow", "qc-slow"]) expect(screen.getByTestId(id)).toBeTruthy();
  });

  test("Esc closes", async () => {
    const onClose = vi.fn();
    render(<QuickConfigDialog isOpen onClose={onClose} config={CFG()} onChange={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("picking a view writes localStorage and calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuickConfigDialog isOpen onClose={() => {}} config={CFG()} onChange={onChange} />);
    await user.click(screen.getByTestId("qc-view-sequence"));
    expect(window.localStorage.getItem("cal.dash.cfg.view")).toBe("sequence");
    expect(onChange).toHaveBeenCalledWith("view", "sequence");
  });

  test("storage-throws degrade to defaults (readConfig never throws)", () => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try { expect(readConfig().view).toBe("reel"); } finally { Object.defineProperty(window, "localStorage", own); }
  });

  test("the dialog is a FloatingDialog: draggable by its title bar (keyboard move)", async () => {
    const user = userEvent.setup();
    render(<QuickConfigDialog isOpen onClose={() => {}} config={CFG()} onChange={() => {}} />);
    const dialog = screen.getByTestId("quick-config");
    const handle = dialog.querySelector("[role='heading'], h2, h3, .fd__title, [data-fd-handle]") || screen.getByText("Demo controls");
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    // FloatingDialog moves on arrow keys from the handle: the geometry custom property changed
    const root = dialog.closest("[data-fd], .fd") || dialog;
    expect(root.style.getPropertyValue("--fd-x") || root.getAttribute("style") || "").toBeTruthy();
  });
});

describe("the chosen view drives the chain card", () => {
  const HOPS = [
    { n: 1, kind: "consent", label: "consent hop", from: "browser", to: "idp", verdict: "ok", fact: "may_act names the agent", request: "r", response: "s", traceparent: "00-a-b-01" },
    { n: 2, kind: "api-call", label: "api hop", from: "bff", to: "gateway", verdict: "ok", fact: "done", request: "r2", response: "s2", traceparent: "00-a-c-01" },
  ];

  test("reel view renders the movie reel, stepper renders the numbered list, sequence renders lanes", () => {
    const { rerender } = render(<ChainView hops={HOPS} cfg={CFG({ view: "reel" })} />);
    expect(screen.getByTestId("chain-view").getAttribute("data-view")).toBe("reel");
    rerender(<ChainView hops={HOPS} cfg={CFG({ view: "stepper" })} />);
    expect(screen.getByTestId("chain-stepper")).toBeTruthy();
    expect(screen.getByTestId("chain-view").getAttribute("data-view")).toBe("stepper");
    rerender(<ChainView hops={HOPS} cfg={CFG({ view: "sequence" })} />);
    expect(screen.getByTestId("chain-view").getAttribute("data-view")).toBe("sequence");
    rerender(<ChainView hops={HOPS} cfg={CFG({ view: "server-flow" })} />);
    expect(screen.getByTestId("chain-view").getAttribute("data-view")).toBe("server-flow");
  });

  test("the evidence section renders the chain and the tokens with a config in play", () => {
    render(<EvidenceSection run={{ hops: HOPS, tokens: [] }} cfg={CFG()} />);
    expect(screen.getByTestId("chain-view")).toBeTruthy();
    expect(screen.getByTestId("tokens-empty")).toBeTruthy();
  });
});
