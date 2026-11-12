import { test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import AirlinePage from "./AirlinePage.jsx";

const FARES = [
  { id: "den-oslo", from: "Denver", to: "Oslo", cents: 41200 },
  { id: "den-tokyo", from: "Denver", to: "Tokyo", cents: 96800 },
];
const STATE0 = { balanceCents: 250000, spentCents: 54300, fares: FARES, bookings: [{ id: "bk-start", fareId: "den-lisbon", from: "Denver", to: "Lisbon", cents: 54300, status: "booked", at: 0 }] };

function mockFetch() {
  const impl = vi.fn((url, opts) => {
    if (String(url).includes("/api/workspace")) { // the workspace token mint (rule 13)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspace: "w-test", token: "t-test" }) });
    }
    if (String(url).includes("/api/bookings") && (!opts || opts.method === "GET")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", ...STATE0 }) });
    }
    return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "unknown_fare" }) });
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("AirlinePage", () => {
  test("renders the hero, fare board and itineraries from the server state", async () => {
    mockFetch();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("airline-balance")).toBeTruthy());
    expect(screen.getByTestId("airline-balance").textContent).toContain("2,500.00");
    expect(screen.getByTestId("fare-board").children.length).toBe(2);
    expect(screen.getByTestId("itineraries").children.length).toBe(1);
  });

  test("Book charges integer cents and shows the updated balance", async () => {
    const impl = mockFetch();
    impl.mockImplementation((url, opts) => {
      if (String(url).includes("/api/workspace")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspace: "w-test", token: "t" }) });
      if (String(url).includes("/book", 12) || url.endsWith("/book")) {
        const body = JSON.parse(opts.body);
        expect(typeof body.key).toBe("string"); // the idempotency key is always sent
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", replay: false, balanceCents: 208800, spentCents: 95500, fares: FARES, bookings: [{ id: "bk-2", fareId: "den-oslo", from: "Denver", to: "Oslo", cents: 41200, status: "booked", at: 1 }, ...STATE0.bookings] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", ...STATE0 }) });
    });
    const user = userEvent.setup();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("book-den-oslo")).toBeTruthy());
    await user.click(screen.getByTestId("book-den-oslo"));
    await waitFor(() => expect(screen.getByTestId("airline-balance").textContent).toContain("2,088.00"));
    expect(screen.getByTestId("itineraries").children.length).toBe(2);
  });

  test("a replay booking surfaces the no-second-charge notice", async () => {
    const impl = mockFetch();
    impl.mockImplementation((url) => {
      if (String(url).includes("/api/workspace")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspace: "w-test", token: "t" }) });
      if (String(url).includes("/book", 12) || url.endsWith("/book")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", replay: true, ...STATE0 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", ...STATE0 }) });
    });
    const user = userEvent.setup();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("book-den-oslo")).toBeTruthy());
    await user.click(screen.getByTestId("book-den-oslo"));
    await waitFor(() => expect(screen.getByTestId("airline-notice").textContent).toContain("no second charge"));
  });

  test("Cancel refunds and the refund badge shows", async () => {
    const impl = mockFetch();
    impl.mockImplementation((url, opts) => {
      if (String(url).includes("/api/workspace")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspace: "w-test", token: "t" }) });
      if (String(url).endsWith("/cancel")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", balanceCents: 304300, spentCents: 0, fares: FARES, bookings: [{ id: "bk-start", fareId: "den-lisbon", from: "Denver", to: "Lisbon", cents: 54300, status: "refunded", at: 0 }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ schema: "bookings/1", ...STATE0 }) });
    });
    const user = userEvent.setup();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("cancel-bk-start")).toBeTruthy());
    await user.click(screen.getByTestId("cancel-bk-start"));
    await waitFor(() => expect(screen.getByTestId("airline-balance").textContent).toContain("3,043.00"));
    expect(screen.getByTestId("itineraries").textContent).toContain("refunded");
  });

  test("Focus | Float: Float wraps the body in the movable airline desk panel", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("fare-board")).toBeTruthy());
    expect(screen.queryByTestId("airline-float")).toBeNull();
    await user.click(screen.getByTestId("mode-float"));
    expect(screen.getByTestId("airline-float")).toBeTruthy();
    await user.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("airline-float")).toBeNull();
    expect(screen.getByTestId("fare-board")).toBeTruthy();
  });

  test("the booking form opens in the FloatingDialog", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("open-booking-form")).toBeTruthy());
    await user.click(screen.getByTestId("open-booking-form"));
    expect(screen.getByTestId("booking-form-dialog")).toBeTruthy();
    expect(screen.getByTestId("bk-fare")).toBeTruthy();
  });

  test("a server error shows inline and the page does not blank", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "insufficient_funds" }) })));
    render(<AirlinePage />);
    await waitFor(() => expect(screen.getByTestId("bookings-error")).toBeTruthy());
    expect(screen.getByTestId("bookings-error").textContent).toContain("insufficient_funds");
  });
});
