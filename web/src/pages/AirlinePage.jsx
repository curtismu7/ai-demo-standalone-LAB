// P9: the airline body — hero, fare board, itineraries, booking form in the vendored FloatingDialog,
// and a Focus | Float switch (Focus = the dashboard grid; Float = the page body inside a movable panel).
// All money is integer cents from the server (bookings/1); the page never computes money itself.
import { useCallback, useEffect, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog.jsx";
import { getBookings, bookFare, cancelBooking } from "../bookingsApi.js";

const fmt = (cents) => (typeof cents === "number" ? `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00");
const money = (cents) => (typeof cents === "number" ? (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00");

function FareBoard({ fares, onBook, busy }) {
  return (
    <ul className="fare-board" data-testid="fare-board" aria-label="Fare board">
      {fares.map((f) => (
        <li key={f.id}>
          <span className="fare-route">{f.from} → {f.to}</span>
          <span className="fare-price">{fmt(f.cents)}</span>
          <button type="button" className="mini" disabled={busy} onClick={() => onBook(f.id)} data-testid={`book-${f.id}`}>Book</button>
        </li>
      ))}
    </ul>
  );
}

function Itineraries({ bookings, onCancel, busy }) {
  return (
    <ul className="itineraries" data-testid="itineraries" aria-label="Your itineraries">
      {bookings.map((b) => (
        <li key={b.id} className={b.status}>
          <span className="fare-route">{b.from} → {b.to}</span>
          <span className="fare-price">{fmt(b.cents)}</span>
          <span className={`badge badge--${b.status}`}>{b.status}</span>
          {b.status === "booked" && (
            <button type="button" className="mini" disabled={busy} onClick={() => onCancel(b.id)} data-testid={`cancel-${b.id}`}>Cancel</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function BookingForm({ fares, onBook, busy }) {
  const [fareId, setFareId] = useState(fares[0]?.id ?? "");
  return (
    <form className="booking-form" onSubmit={(e) => { e.preventDefault(); onBook(fareId); }} aria-label="Book a flight">
      <label htmlFor="bk-fare">Flight</label>
      <select id="bk-fare" value={fareId} onChange={(e) => setFareId(e.target.value)} data-testid="bk-fare">
        {fares.map((f) => <option key={f.id} value={f.id}>{f.from} → {f.to} — {money(f.cents)}</option>)}
      </select>
      <button type="submit" className="primary" disabled={busy} data-testid="bk-submit">Book flight</button>
    </form>
  );
}

export default function AirlinePage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [floatMode, setFloatMode] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    try { setState(await getBookings()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const book = useCallback(async (fareId) => {
    setBusy(true); setError(null);
    try {
      // the idempotency key: one per booking INTENT (a double click can never double-book)
      const r = await bookFare(fareId, `web-${fareId}-${Date.now()}`);
      setState(r);
      setNotice(r.replay ? "That booking was already made — no second charge." : `Booked ${r.bookings[0]?.from} → ${r.bookings[0]?.to}.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, []);

  const cancel = useCallback(async (id) => {
    setBusy(true); setError(null);
    try { setState(await cancelBooking(id)); setNotice("Cancelled — full refund on its way."); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, []);

  if (error && !state) return <p className="muted" data-testid="bookings-error">The booking desk is not answering: {error}</p>;
  if (!state) return <p className="muted" role="status">Loading the fare board…</p>;

  const body = (
    <>
      <div className="hero" data-testid="airline-hero">
        <p className="eyebrow" id="airline-hero-h">Mock airline — your account</p>
        <p className="hero-balance" data-testid="airline-balance">{fmt(state.balanceCents)}</p>
        <p className="muted">Booked: {fmt(state.spentCents)} · all amounts are simulated, integer cents, per browser workspace.</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="airline-notice">{notice ?? ""}</p>
      {error && <p className="error" data-testid="airline-error">{error}</p>}
      <FareBoard fares={state.fares} onBook={book} busy={busy} />
      <h2 id="itin-h">Your itineraries</h2>
      <Itineraries bookings={state.bookings} onCancel={cancel} busy={busy} />
      <button type="button" className="primary" onClick={() => setFormOpen(true)} data-testid="open-booking-form">Book a flight…</button>
      <FloatingDialog
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title="Book a flight"
        ariaLabel="Book a flight"
        singletonKey="airline-booking-form"
        testId="booking-form-dialog"
        defaultWidth={420}
        defaultHeight={null}
      >
        <BookingForm fares={state.fares} onBook={(fid) => { setFormOpen(false); book(fid); }} busy={busy} />
      </FloatingDialog>
    </>
  );

  return (
    <section className="airline" aria-labelledby="airline-hero-h" data-testid="airline-page">
      <div className="seg" role="group" aria-label="Page mode" data-testid="airline-mode">
        <button type="button" aria-pressed={!floatMode} data-testid="mode-focus" onClick={() => setFloatMode(false)}>Focus</button>
        <button type="button" aria-pressed={floatMode} data-testid="mode-float" onClick={() => setFloatMode(true)}>Float</button>
      </div>
      {floatMode ? (
        <FloatingDialog
          isOpen={floatMode}
          onClose={() => setFloatMode(false)}
          title="Airline desk"
          ariaLabel="Airline desk"
          noBackdrop
          disablePopOut
          singletonKey="airline-desk"
          testId="airline-float"
          defaultWidth={560}
          defaultHeight={null}
        >
          {body}
        </FloatingDialog>
      ) : body}
    </section>
  );
}
