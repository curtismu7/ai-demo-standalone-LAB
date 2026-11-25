// Rule 27 + rule 13: the run panel asks for its run as the workspace that recorded it, so the server answers only that workspace's run.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import RunObs from "./RunObs.jsx";
import { workspaceId } from "../workspace.js";

const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("the run panel asks for its run as its own workspace", () => {
  it("the record request carries this tab's X-Workspace", async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).startsWith("/api/workspace") ? json({ token: "t-test" }) : json({ record: null, message: "gone" })));
    render(<RunObs head={{ runId: "run-abc123-1" }} />);
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).startsWith("/api/runs/record"))).toBe(true));
    const [, opts] = globalThis.fetch.mock.calls.find(([u]) => String(u).startsWith("/api/runs/record"));
    expect(opts?.headers?.["x-workspace"]).toBe(workspaceId());
  });
});
