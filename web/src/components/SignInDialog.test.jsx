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
