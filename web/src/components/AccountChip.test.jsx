import { test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import AccountChip from "./AccountChip.jsx";

const INFO_OUT = { available: true, method: "pi.flow", provider: "pingone", username: "lab-demo-user", signedIn: false, user: null };

function mockFetch(handler) {
  const impl = vi.fn((url, opts) => {
    if (String(url).includes("/api/workspace")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspace: "w-test", token: "t" }) });
    return handler(String(url), opts);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}
const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("AccountChip (P10 Real sign-in)", () => {
  test("hidden entirely when the sign-in is not configured", async () => {
    mockFetch(() => json({ available: false, reason: "the app .env has no valid AIDEMOLAB_SIGNIN_CLIENT_ID" }));
    render(<AccountChip />);
    await waitFor(() => expect(screen.queryByTestId("open-signin")).toBeNull());
    expect(screen.queryByTestId("account-chip")).toBeNull();
  });

  test("Sign in opens the dialog; a successful pi.flow sign-in shows the user and the REAL token", async () => {
    const user = userEvent.setup();
    const TOKEN = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ1LTExIiwicHJlZmVycmVkX3VzZXJuYW1lIjoibGFiLWRlbW8tdXNlciJ9", "sig"].join(".");
    let phase = "out";
    mockFetch((url, opts) => {
      if (url.endsWith("/api/signin") && (!opts || opts.method === "GET" || opts.method === undefined)) {
        return json(phase === "out" ? { ...INFO_OUT } : { ...INFO_OUT, signedIn: true, user: { sub: "u-11", name: "lab-demo-user", expiresAt: "2030-01-01T00:00:00Z" } });
      }
      if (url.endsWith("/api/signin") && opts?.method === "POST") {
        const body = JSON.parse(opts.body);
        expect(body.password).toBeTruthy();
        phase = "in";
        return json({ signedIn: true, user: { sub: "u-11", name: "lab-demo-user" }, steps: [], tokens: [{ label: "user access token (REAL)", real: true, raw: TOKEN, header: {}, claims: {} }] });
      }
      if (url.endsWith("/api/signout") && opts?.method === "POST") { phase = "out"; return json({ signedIn: false }); }
      return json({});
    });
    render(<AccountChip />);
    await waitFor(() => expect(screen.getByTestId("open-signin")).toBeTruthy());
    await user.click(screen.getByTestId("open-signin"));
    expect(screen.getByTestId("signin-dialog")).toBeTruthy();
    expect(screen.getByTestId("signin-username")).toHaveValue("lab-demo-user");
    await user.type(screen.getByTestId("signin-password"), "whatever-pass");
    await user.click(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(screen.getByTestId("account-user").textContent).toBe("lab-demo-user"));
    // the password field is gone with the dialog, and the password is nowhere in the DOM
    expect(screen.queryByTestId("signin-dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("whatever-pass");
    // REAL token behind the toggle
    expect(screen.queryByTestId("real-token")).toBeNull();
    await user.click(screen.getByTestId("toggle-token"));
    const tok = screen.getByTestId("real-token");
    expect(tok.textContent).toContain("REAL");
    expect(tok.textContent).toContain(TOKEN.slice(0, 20));
    // sign out
    await user.click(screen.getByTestId("signout"));
    await waitFor(() => expect(screen.getByTestId("open-signin")).toBeTruthy());
  });

  test("a refused sign-in shows the fixed error and keeps the dialog open", async () => {
    const user = userEvent.setup();
    mockFetch((url, opts) => {
      if (url.endsWith("/api/signin") && opts?.method === "POST") {
        return { ok: false, status: 401, json: () => Promise.resolve({ error: "signin_rejected", message: "The IdP did not accept the username or password." }) };
      }
      return json({ ...INFO_OUT });
    });
    render(<AccountChip />);
    await waitFor(() => expect(screen.getByTestId("open-signin")).toBeTruthy());
    await user.click(screen.getByTestId("open-signin"));
    await user.type(screen.getByTestId("signin-password"), "wrong-pass-1");
    await user.click(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(screen.getByTestId("signin-error").textContent).toContain("did not accept"));
    expect(screen.getByTestId("signin-dialog")).toBeTruthy();
  });
});
