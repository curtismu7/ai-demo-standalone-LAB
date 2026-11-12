import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookings } from '../src/bookings.js';

test('the traveller starts with $2500, one booked itinerary and the fare board', () => {
  const b = createBookings();
  const s = b.state();
  assert.equal(s.balanceCents, 250000);
  assert.equal(s.spentCents, 54300);
  assert.equal(s.fares.length, 5);
  assert.equal(s.bookings.length, 1);
  assert.equal(s.bookings[0].id, 'bk-start');
  assert.equal(s.bookings[0].status, 'booked');
});

test('booking debits integer cents and appends the itinerary', () => {
  const b = createBookings();
  const r = b.book({ fareId: 'den-oslo' });
  assert.equal(r.replay, false);
  assert.equal(r.booking.cents, 41200);
  const s = b.state();
  assert.equal(s.balanceCents, 250000 - 41200);
  assert.equal(s.spentCents, 54300 + 41200);
  assert.equal(s.bookings.length, 2);
});

test('idempotency: the same key returns the SAME booking and never re-charges', () => {
  const b = createBookings();
  const a = b.book({ fareId: 'den-oslo', key: 'k-1' });
  const again = b.book({ fareId: 'den-oslo', key: 'k-1' });
  assert.equal(again.replay, true);
  assert.equal(again.booking.id, a.booking.id);
  assert.equal(b.state().balanceCents, 250000 - 41200);
  assert.equal(b.state().bookings.length, 2);
});

test('a different key books a different seat', () => {
  const b = createBookings();
  b.book({ fareId: 'den-oslo', key: 'k-1' });
  const other = b.book({ fareId: 'den-oslo', key: 'k-2' });
  assert.equal(other.replay, false);
  assert.notEqual(other.booking.id, 'bk-1');
  assert.equal(b.state().balanceCents, 250000 - 2 * 41200);
});

test('insufficient funds refuses and leaves the balance untouched', () => {
  const b = createBookings();
  // spend down to below the Tokyo fare
  b.book({ fareId: 'den-nairobi', key: 'a' }); // 87900
  b.book({ fareId: 'den-tokyo', key: 'b' }); // 96800
  const s = b.state();
  const before = s.balanceCents;
  const r = b.book({ fareId: 'den-tokyo', key: 'c' });
  assert.equal(r.error, 'insufficient_funds');
  assert.equal(b.state().balanceCents, before);
});

test('cancel refunds in full; cancelling twice is refused', () => {
  const b = createBookings();
  const { booking } = b.book({ fareId: 'den-oslo' });
  const c = b.cancel({ id: booking.id });
  assert.equal(c.booking.status, 'refunded');
  assert.equal(b.state().balanceCents, 250000);
  const again = b.cancel({ id: booking.id });
  assert.equal(again.error, 'already_refunded');
  assert.equal(b.state().balanceCents, 250000);
});

test('an unknown fare and an unknown booking are refused', () => {
  const b = createBookings();
  assert.equal(b.book({ fareId: 'nope' }).error, 'unknown_fare');
  assert.equal(b.cancel({ id: 'nope' }).error, 'unknown_booking');
});
