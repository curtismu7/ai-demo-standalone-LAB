// P5 launcher: route chips per use case, search, and the same-tab navigation rules.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Launcher, { chipFor, proxied } from "./Launcher.jsx";

vi.mock("../api", () => ({
  getUseCases: vi.fn(),
}));

import { getUseCases } from "../api";

const ROWS = [
  { id: "UC1", title: "Delegated access (consent only)", route: "Here + go deeper", apps: ["delegation-lab"], path: "/delegation-lab/", runsHere: true },
  { id: "UC12", title: "Token theft / replay defense", route: "Hand off", apps: ["stolen-token-lab"], path: "/stolen-token-lab/", runsHere: false },
  { id: "UC-LEARN1", title: "OAuth Academy", route: "Guide", apps: [], path: null, runsHere: false },
];

const HREF = (uc, app) => ({ body: { rows: ROWS, href: `../${app}/?from=ai-demo-standalone&uc=${uc}` } });

beforeEach(() => { getUseCases.mockReset(); });
afterEach(() => { window.localStorage.clear(); });

describe("chipFor", () => {
  test("runs here, opens app, guide", () => {
    expect(chipFor(ROWS[0])).toMatchObject({ kind: "here", label: "Runs here + deeper" });
    expect(chipFor(ROWS[1])).toMatchObject({ kind: "open", app: "stolen-token-lab", label: "Opens stolen-token-lab" });
    expect(chipFor(ROWS[2])).toMatchObject({ kind: "guide", label: "Guide" });
  });
});

describe("proxied", () => {
  test("true under /ai-demo-standalone/, false on a plain port", () => {
    const orig = window.location;
    expect(proxied()).toBe(false); // jsdom default path /
    try {
      delete window.location;
      window.location = { ...orig, pathname: "/ai-demo-standalone/" };
      expect(proxied()).toBe(true);
    } finally { window.location = orig; }
  });
});

describe("Launcher", () => {
  test("renders one chip per row; a guide chip is disabled", async () => {
    getUseCases.mockResolvedValue({ ok: true, status: 200, body: { rows: ROWS, href: null } });
    const orig = window.location;
    try {
      delete window.location;
      window.location = { ...orig, pathname: "/ai-demo-standalone/" };
      render(<Launcher />);
    await waitFor(() => expect(screen.getByTestId("uc-chip-UC1")).toBeTruthy());
    expect(screen.getByTestId("uc-chip-UC12").textContent).toBe("Opens stolen-token-lab");
    expect(screen.getByTestId("uc-chip-UC-LEARN1")).toHaveProperty("disabled", true);
    } finally { window.location = orig; }
  });

  test('"Runs here" calls onRunHere with the use case id', async () => {
    const user = userEvent.setup();
    const onRunHere = vi.fn();
    getUseCases.mockResolvedValue({ ok: true, status: 200, body: { rows: ROWS, href: null } });
    render(<Launcher onRunHere={onRunHere} />);
    await waitFor(() => expect(screen.getByTestId("uc-chip-UC1")).toBeTruthy());
    await user.click(screen.getByTestId("uc-chip-UC1"));
    expect(onRunHere).toHaveBeenCalledWith("UC1");
  });

  test('"Opens <app>" navigates in the same tab to the server-built href', async () => {
    const user = userEvent.setup();
    getUseCases.mockImplementation((uc, app) => Promise.resolve(HREF(uc, app)));
    const orig = window.location;
    const assign = vi.fn();
    try {
      delete window.location;
      window.location = { ...orig, pathname: "/ai-demo-standalone/", assign };
      render(<Launcher />);
      await waitFor(() => expect(screen.getByTestId("uc-chip-UC12")).toBeTruthy());
      await user.click(screen.getByTestId("uc-chip-UC12"));
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(assign.mock.calls[0][0]).toBe("../stolen-token-lab/?from=ai-demo-standalone&uc=UC12");
    } finally { window.location = orig; }
  });

  test('behind a plain port the chip reads "Start <app> from the Shelf" and never navigates', async () => {
    const user = userEvent.setup();
    getUseCases.mockImplementation((uc, app) => Promise.resolve(HREF(uc, app)));
    const orig = window.location;
    const assign = vi.fn();
    try {
      delete window.location;
      window.location = { ...orig, pathname: "/", assign };
      render(<Launcher />);
      await waitFor(() => expect(screen.getByTestId("uc-chip-UC12")).toBeTruthy());
      expect(screen.getByTestId("uc-chip-UC12").textContent).toBe("Start stolen-token-lab from the Shelf");
      await user.click(screen.getByTestId("uc-chip-UC12"));
      expect(assign).not.toHaveBeenCalled();
    } finally { window.location = orig; }
  });

  test("search narrows the rows by id or title", async () => {
    const user = userEvent.setup();
    getUseCases.mockResolvedValue({ ok: true, status: 200, body: { rows: ROWS, href: null } });
    render(<Launcher />);
    await waitFor(() => expect(screen.getAllByTestId(/^uc-row-/)).toHaveLength(3));
    await user.type(screen.getByTestId("uc-search"), "token theft");
    expect(screen.getAllByTestId(/^uc-row-/)).toHaveLength(1);
    expect(screen.getByTestId("uc-row-UC12")).toBeTruthy();
  });
});
