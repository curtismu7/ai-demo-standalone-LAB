// The Observability page: this workspace's audit trail, read from GET /api/runs —
// the same per-workspace run log the engine writes on every authorize, challenge,
// receipt, directory flip, A2A exchange and attack run. Read-only by design: the
// visitor watches the log fill as runs happen elsewhere in the app.
import { useEffect, useState } from "react";
import { getRuns } from "../api";
import { visible } from "../safeText";

const decisionClass = (d) =>
  d === "PERMIT" || d === "MINTED" || d === "NARROWED" || d === "RECEIPT" ? "tag--ok"
    : d === "FLIPPED" || d === "CHALLENGED" ? "tag--warn"
    : "tag--deny";

export default function ObservabilityPage() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getRuns().then(
      (j) => { if (alive) { setRuns(j.runs || []); setError(null); } },
      (e) => { if (alive) setError(e.message); },
    );
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div data-testid="observability-page">
      <h1>Observability</h1>
      <p className="muted">
        The audit trail for THIS workspace's tab: every authorize, challenge, receipt,
        directory flip, A2A exchange and attack run is logged server-side with what was
        attempted and what the policy answered. It refreshes every few seconds; run a
        prompt on the <a href="#/dashboard">Dashboard</a> or a use case on{" "}
        <a href="#/use-cases">Use Cases</a> and watch it land here.
      </p>
      {error && <p className="field-error" role="alert">Could not load the run log ({error}).</p>}
      {runs && runs.length === 0 && (
        <p className="muted" data-testid="runs-empty">
          No runs recorded in this workspace yet. Nothing is logged until the first call.
        </p>
      )}
      {runs && runs.length > 0 && (
        <table className="obs-table" data-testid="runs-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Tool / action</th><th scope="col">Decision</th><th scope="col">What happened</th></tr>
          </thead>
          <tbody>
            {[...runs].reverse().map((r, i) => (
              <tr key={`${r.at}-${i}`} data-testid="runs-row">
                <td className="mono">{new Date(r.at).toLocaleTimeString()}</td>
                <td className="mono">{visible(r.tool || "(unknown)")}</td>
                <td><span className={`tag ${decisionClass(r.decision)}`}>{visible(r.decision || "?")}</span></td>
                <td>{visible(r.reason || "")}{r.blocked ? <span className="muted"> · code {visible(r.blocked)}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
