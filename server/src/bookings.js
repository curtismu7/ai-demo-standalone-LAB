// P9: the mock airline booking system. Per-workspace, integer cents, idempotent.
// The traveller starts with a balance and one booked itinerary; a booking POST is
// idempotent on the client-supplied key (replaying the same key returns the SAME
// booking, never a second charge). Cancellation refunds in full. All money is
// integer cents — never a float.
const CENTS = (n) => Math.round(n); // guard: inputs arrive as integers; never accumulate float dust

const FARES = [
  { id: 'den-oslo', from: 'Denver', to: 'Oslo', cents: 41200 },
  { id: 'den-tokyo', from: 'Denver', to: 'Tokyo', cents: 96800 },
  { id: 'den-lima', from: 'Denver', to: 'Lima', cents: 38700 },
  { id: 'den-lisbon', from: 'Denver', to: 'Lisbon', cents: 54300 },
  { id: 'den-nairobi', from: 'Denver', to: 'Nairobi', cents: 87900 },
];

const START_BALANCE_CENTS = 250000; // $2,500.00
const STARTING_BOOKING = { id: 'bk-start', fareId: 'den-lisbon', from: 'Denver', to: 'Lisbon', cents: 54300, status: 'booked', at: 0 };

export function createBookings({ now = Date.now } = {}) {
  let balance = CENTS(START_BALANCE_CENTS);
  let seq = 1;
  const bookings = [{ ...STARTING_BOOKING }];
  const idem = new Map(); // idempotency key -> booking id

  const spent = () => bookings.filter((b) => b.status === 'booked').reduce((s, b) => s + b.cents, 0);

  return {
    /** Everything the page needs: balance, spend, fares and the itinerary list (newest first). */
    state() {
      return {
        balanceCents: balance,
        spentCents: spent(),
        fares: FARES,
        bookings: [...bookings].sort((a, b) => b.at - a.at),
      };
    },
    /** Book a fare. Idempotent: the same key returns the same booking (and never re-charges). */
    book({ fareId, key }) {
      const fare = FARES.find((f) => f.id === fareId);
      if (!fare) return { error: 'unknown_fare' };
      if (key && idem.has(key)) {
        const again = bookings.find((b) => b.id === idem.get(key));
        if (again) return { booking: again, replay: true };
      }
      if (balance < fare.cents) return { error: 'insufficient_funds' };
      balance -= fare.cents;
      const booking = { id: `bk-${seq++}`, fareId: fare.id, from: fare.from, to: fare.to, cents: fare.cents, status: 'booked', at: now() };
      bookings.push(booking);
      if (key) idem.set(key, booking.id);
      return { booking, replay: false };
    },
    /** Cancel a booking: full refund. Cancelling twice is refused (already refunded). */
    cancel({ id }) {
      const booking = bookings.find((b) => b.id === id);
      if (!booking) return { error: 'unknown_booking' };
      if (booking.status !== 'booked') return { error: 'already_refunded' };
      booking.status = 'refunded';
      balance += booking.cents;
      return { booking };
    },
  };
}
