import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
const calls = [];
vi.mock("./api", () => ({
  getJson: vi.fn(async (url) => { calls.push(url); return {}; }),
  getRuns: vi.fn(async () => { calls.push("/api/runs"); return { runs: [] }; }),
}));
import App from "./App";
describe("dbg", () => {
  it("obs page", async () => {
    window.location.hash = "#/observability";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("observability-page")).toBeTruthy());
    console.log("CALLS", JSON.stringify(calls));
  });
});
