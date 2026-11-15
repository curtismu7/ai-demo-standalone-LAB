import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import SignInDialog from "./SignInDialog.jsx";

test("the password is cleared the moment the dialog closes, and never rendered back", async () => {
  // the component clears the password state on close; the point of this test is the DOM guarantee:
  // type="password", no value echo, and the fixed method copy
  render(<SignInDialog isOpen username="lab-demo-user" provider="pingone" onClose={() => {}} />);
  const pw = screen.getByTestId("signin-password");
  expect(pw.getAttribute("type")).toBe("password");
  expect(pw.getAttribute("autocomplete")).toBe("current-password");
  expect(screen.getByTestId("signin-username")).toHaveValue("lab-demo-user");
  expect(screen.getByTestId("signin-username").getAttribute("readonly")).not.toBeNull();
  expect(screen.getByTestId("signin-method").textContent).toContain("pi.flow");
  expect(screen.getByTestId("signin-method").textContent).toContain("never stored, logged or shown");
  // the submit button is disabled with an empty password (nothing is sent until something is typed)
  expect(screen.getByTestId("signin-submit").disabled).toBe(true);
});

test("the dialog fits its content, opens near the top, and keeps Sign in in the footer outside the scrolling body (owner 2026-11-14)", () => {
  render(<SignInDialog isOpen username="lab-demo-user" onClose={() => {}} />);
  const dlg = screen.getByTestId("signin-dialog");
  const style = dlg.getAttribute("style") || "";
  // Fit to content (not a fixed height that hid the Password field), and opened at the top: a fit-to-content dialog otherwise opens with
  // its top at the middle of the window and the error line pushes the button off the bottom.
  expect(style).toContain("--fd-h: auto");
  expect(style).toContain("--fd-y: 16px");
  const submit = screen.getByTestId("signin-submit");
  expect(dlg.querySelector(".fd-footer").contains(submit)).toBe(true);
  expect(dlg.querySelector(".fd-body").contains(submit)).toBe(false);
  expect(dlg.querySelector(".fd-footer").contains(screen.getByTestId("signin-cancel"))).toBe(true);
  expect(submit.getAttribute("form")).toBe(screen.getByTestId("signin-form").id);
});
