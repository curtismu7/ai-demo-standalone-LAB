// The family-standard simulation banner, rendered first inside <main> on every page.
export default function SimBanner() {
  return (
    <p
      className="banner"
      role="note"
      data-testid="sim-banner"
    >
      SIMULATED: bookings, tokens and decisions on this page come from this lab's mock engine and mock policy. The assistant is scripted. Nothing calls a real airline, identity provider, gateway or tenant. Every value is a labelled demo value.
    </p>
  );
}
