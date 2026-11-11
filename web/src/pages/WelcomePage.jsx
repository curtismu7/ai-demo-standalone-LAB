// ui-pattern: allow P3 the wide frame is an approved exception for this lab's catalog layout
import { Link } from "../shell/routeLink.jsx";

export default function WelcomePage() {
  return (
    <div className="welcome" data-testid="welcome-page">
      <h1>Welcome</h1>
      <section className="panel">
        <h2>What this is</h2>
        <p>
          A simulated airline dashboard: an AI agent that can look up flights, change bookings and issue refunds,
          and one mock policy engine that gates every call — token, delegation chain, groups, tier bands and
          human-in-the-loop approvals. Everything is mock: no real airline, identity provider, gateway or tenant
          is ever contacted.
        </p>
      </section>
      <section className="panel">
        <h2>Three things to try</h2>
        <ul className="facts">
          <li>Run a live scenario on the <Link href="#/dashboard">Dashboard</Link>: consent mints a delegated token and the mock policy decides.</li>
          <li>Browse the 87-use-case catalog under <Link href="#/use-cases">Use Cases</Link> and open any use case's detail.</li>
          <li>Read the walkthrough and the decision-chain diagram in the <Link href="#/guide">Guide</Link>.</li>
        </ul>
      </section>
    </div>
  );
}
