// ?returned=<app>&uc=<id>: the return select. Ids only; the app must be one this lab hands
// off to; the two parameters are always stripped from the address bar.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { takeReturn, HANDOFF_APPS } from "./returned.js";

beforeEach(() => { window.history.replaceState(null, "", "/"); });
afterEach(() => { vi.unstubAllGlobals?.(); });

describe("takeReturn", () => {
  it("reads a valid hand-off return and strips the two parameters", () => {
    window.history.replaceState(null, "", "/?returned=stolen-token-lab&uc=UC12#/dashboard");
    expect(takeReturn()).toEqual({ app: "stolen-token-lab", uc: "UC12" });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("keeps other parameters", () => {
    window.history.replaceState(null, "", "/?returned=obo-lab&uc=UC16&present=1");
    expect(takeReturn()).toEqual({ app: "obo-lab", uc: "UC16" });
    expect(window.location.search).toBe("?present=1");
  });

  it("an app this page never handed off to is ignored (but still stripped)", () => {
    window.history.replaceState(null, "", "/?returned=evil.example&uc=UC12");
    expect(takeReturn()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("malformed ids, repeats and missing parts give null; the params strip only when returned is present", () => {
    for (const q of [
      "?returned=stolen-token-lab", "?returned=stolen-token-lab&returned=obo-lab&uc=UC12",
      "?returned=stolen-token-lab&uc=a%20b", "?returned=<b>&uc=UC12", "?returned=toString&uc=UC12",
    ]) {
      window.history.replaceState(null, "", "/" + q);
      expect(takeReturn(), q).toBeNull();
      expect(window.location.search).toBe("");
    }
    // a bare uc belongs to the ?from=customer-agent flow: it must NOT be stripped
    window.history.replaceState(null, "", "/?uc=UC12");
    expect(takeReturn()).toBeNull();
    expect(window.location.search).toBe("?uc=UC12");
  });

  it("no query at all is a plain load: null, address bar untouched", () => {
    window.history.replaceState(null, "", "/?x=1#/dashboard");
    expect(takeReturn()).toBeNull();
    expect(window.location.search).toBe("?x=1");
  });

  it("the hand-off list covers every redirect target of this lab", () => {
    expect(HANDOFF_APPS.length).toBeGreaterThanOrEqual(25);
    expect(HANDOFF_APPS).toContain("stolen-token-lab");
    expect(HANDOFF_APPS).toContain("ai-guard-sidecar");
  });
});
