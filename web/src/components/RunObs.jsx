// Rule 27: the shared run-observability panel for this lab, with the lab's own states around it. The panel shows ONE run: one recorded
// action (an authorize, a challenge, a receipt, a consent mint, an A2A exchange or tool call, an attack run, an NHI step). The answer to
// that action says which run it was (`run: { id }`); this file reads that field and never guesses it. Nothing is re-read on a timer and
// there is no re-read button: this lab reads no logs, so a re-read could find nothing new.
import React, { useEffect, useState } from "react";
import RunObservability from "../run-observability/RunObservability.jsx";

// Where this lab's run leaves logs and where they can stream (the README says the same).
export const LOG_STREAMS = [
  { product: "AI demo standalone LAB (this lab's container)", lives: "its stdout. Each decision of a run is one line: the time, a step, the layer, the actor, a result and a run id. A line never holds a token, a person's name or an address. Mock writes one line per recorded action", streams: "nowhere today: the family log collector's source list does not name this container, so it would need an entry first" },
];

const TITLE = "What each layer logged for this run";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** What the server said about the run of one answer: { runId } | { none: text } | { bad: true } (the answer did not say). `d` is the answer's JSON body. */
export function headOf(d) {
  if (isObj(d) && "obs" in d) {
    if (isObj(d.obs) && typeof d.obs.id === "string" && d.obs.id) return { runId: d.obs.id };
    if (d.obs === null) return { none: typeof d.obsNote === "string" && d.obsNote ? d.obsNote : "This request began no run, so nothing was recorded." };
  }
  return { bad: true };
}

// The record route's answer -> what to show. Pure and total: no shape of answer can throw here.
function shapeOf(r) {
  const d = r?.data;
  if (!r?.ok) return { problem: isObj(d) && typeof d.detail === "string" && d.detail ? d.detail : `The lab answered ${r?.status ?? "nothing"} when asked for this run's record.` };
  if (isObj(d) && "record" in d) {
    if (d.record === null) return { empty: typeof d.message === "string" && d.message ? d.message : "There is no record for this run." };
    if (isObj(d.record)) return { record: d.record };
  }
  return { problem: "The lab's answer was not a run record." };
}

const Note = ({ id, role, children }) => (
  <section className="ro" data-testid={id} aria-label={TITLE}>
    <h2>{TITLE}</h2>
    <p className="ro-muted" role={role}>{children}</p>
  </section>
);

// The one line under the panel: what a row is in this lab, true for every recorded action.
const NOTE = "Rows are what the lab's mock computed for one recorded action; nothing is read from a product log. One action is one row in the layer that decided it: the PDP verdict (PERMIT, DENY, OBLIGATION) is the Authorize layer, a token mint (consent, A2A exchanges) is an allowed Privilege row, and an attack narrow or block is the Resource server layer. The gateway is modelled inline and holds no separate decision. Person is the subject and Agent the actor, both read from the token the action minted or inspected; Scopes are the token's scope claim. The policy node names the PDP verdict with its use-case id.";

export default function RunObs({ head, loading = false, empty = "Nothing has run yet. Run an action and its record appears here." }) {
  const runId = !loading && head?.runId ? head.runId : null;
  const key = runId ?? (head?.none ? "none" : head ? "bad" : "empty");
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    const done = (a) => { if (live) setAnswer({ key, ...a }); };
    fetch(`/api/runs/record?runId=${encodeURIComponent(runId)}`).then(async (r) => done(shapeOf({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))).catch((e) => done({ problem: `Could not reach the lab (${String(e?.message || e).slice(0, 120)}).` }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new run asks again; nothing else does

  if (loading) return <Note id="ro-loading">Collecting this run's logs…</Note>;
  if (!head) return <Note id="ro-empty">{empty}</Note>;
  if (head.bad) return <Note id="ro-bad" role="alert">The lab's answer did not say which run it was, so there is no record to show (and no older one is shown in its place).</Note>;
  if (head.none) return <Note id="ro-no-run">{head.none}</Note>;
  if (!answer || answer.key !== key) return <Note id="ro-loading">Collecting this run's logs…</Note>; // never the previous record
  if (answer.problem) return <Note id="ro-problem" role="alert">{answer.problem}</Note>;
  if (answer.empty) return <Note id="ro-gone">{answer.empty}</Note>;
  return (
    <div data-testid="ro-wrap">
      <RunObservability record={answer.record} source="mock" streams={LOG_STREAMS} />
      <p className="ro-muted" data-testid="ro-lab-note">{NOTE}</p>
    </div>
  );
}
