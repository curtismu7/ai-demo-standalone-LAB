// P9: the bookings API client — thin fetch wrappers over the bookings/1 routes.
import { workspaceFetch } from "./workspace";

async function call(path, opts) {
  const r = await workspaceFetch(path, opts);
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
  return r.json();
}

export const getBookings = () => call("/api/bookings", { method: "GET" });
export const bookFare = (fareId, key) => call("/api/bookings/book", { method: "POST", body: JSON.stringify({ fareId, key }) });
export const cancelBooking = (id) => call("/api/bookings/cancel", { method: "POST", body: JSON.stringify({ id }) });
