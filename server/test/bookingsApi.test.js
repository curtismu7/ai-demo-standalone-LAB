import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';

const post = (url, p, body, ws = 'bk-probe') => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
const get = (url, p, ws = 'bk-probe') => fetch(url + p, { headers: { origin: url, 'x-workspace': ws } });

test('the booking system: state, book, idempotency, cancel, reset', async () => {
  await withServer(async (url) => {
    const s0 = await (await get(url, '/api/bookings')).json();
    assert.equal(s0.schema, 'bookings/1');
    assert.equal(s0.balanceCents, 250000);
    assert.equal(s0.bookings.length, 1);

    const b1 = await (await post(url, '/api/bookings/book', { fareId: 'den-oslo', key: 'k-1' })).json();
    assert.equal(b1.replay, false);
    assert.equal(b1.balanceCents, 250000 - 41200);

    // idempotent: the same key, the same booking, no second charge
    const b2 = await (await post(url, '/api/bookings/book', { fareId: 'den-oslo', key: 'k-1' })).json();
    assert.equal(b2.replay, true);
    assert.equal(b2.balanceCents, b1.balanceCents);

    // cancel refunds
    const id = b1.bookings.find((x) => x.fareId === 'den-oslo').id;
    const c = await (await post(url, '/api/bookings/cancel', { id })).json();
    assert.equal(c.balanceCents, 250000);

    // unknown fare is a 400
    const bad = await post(url, '/api/bookings/book', { fareId: 'nope' });
    assert.equal(bad.status, 400);

    // reset restores the start state (the workspace's bookings live in extra)
    const startId = b1.bookings[0].id;
    await post(url, '/api/reset', {});
    const s1 = await (await get(url, '/api/bookings')).json();
    assert.equal(s1.balanceCents, 250000);
    assert.equal(s1.bookings.length, 1);
    assert.notEqual(s1.bookings[0].id, startId || undefined);
    assert.equal(s1.bookings[0].id, 'bk-start');
  });
});

test('per-workspace isolation: two travellers never share a balance or a booking', async () => {
  await withServer(async (url) => {
    await post(url, '/api/bookings/book', { fareId: 'den-tokyo', key: 'a' }, 'traveller-1');
    const s1 = await (await get(url, '/api/bookings', 'traveller-1')).json();
    assert.equal(s1.balanceCents, 250000 - 96800);
    const s2 = await (await get(url, '/api/bookings', 'traveller-2')).json();
    assert.equal(s2.balanceCents, 250000);
    assert.equal(s2.bookings.length, 1);
  });
});
