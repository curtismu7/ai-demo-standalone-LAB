import { beforeEach, describe, expect, test } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenCardsPanel from "./TokenCardsPanel.jsx";
import { setJsonView } from "./JsonPane.jsx";

const TOKENS = [{
  id: "exchange", title: "Exchanged token", role: "carries both parties", mock: true,
  claims: { sub: "demoUser", act: { sub: "demo-agent" }, aud: "ai-demo-standalone", iat: 1700000000 },
  diff: null,
}];

beforeEach(() => setJsonView("form"));

describe("TokenCardsPanel: raw claims go through the shared JsonPane (Rule 24)", () => {
  test("the raw claims pane has the Form | JSON toggle and shows the exact JSON text in the JSON view", async () => {
    const user = userEvent.setup();
    render(<TokenCardsPanel tokens={TOKENS} />);
    const group = screen.getByRole("group", { name: "Exchanged token claims view" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Form", "JSON"]);
    await user.click(within(group).getByRole("button", { name: "JSON" }));
    const pane = screen.getByLabelText("Exchanged token claims");
    expect(pane.tagName).toBe("PRE");
    expect(pane.textContent).toBe(JSON.stringify(TOKENS[0].claims, null, 2));
  });

  test("an object claim in the claims list is a pane too, and the page keeps one view choice", async () => {
    render(<TokenCardsPanel tokens={TOKENS} />);
    expect(screen.getByRole("group", { name: "act claim view" })).toBeTruthy();
    const actPane = screen.getByLabelText("act claim");
    expect(actPane.textContent).toContain("demo-agent");
    act(() => setJsonView("raw"));
    expect(screen.getByLabelText("act claim").tagName).toBe("PRE");
  });
});
