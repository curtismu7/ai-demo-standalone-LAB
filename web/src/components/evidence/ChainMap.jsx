// P3 (lab-own): the 10-step chain map row. Each step's state derives from the run's
// demo-hop/1 hops: OK (green) / HELD (amber) / DENIED (red) / NOT IN RUN (dimmed).
// Click a step to open the vendored StepDetailPanel on the hop it maps to.
const STATE_WORD = { ok: "done", deny: "denied", held: "held", "not-in-run": "not in run" };

export default function ChainMap({ steps = [], selectedHop = null, onSelectStep }) {
  return (
    <ol className="cm-row" data-testid="chain-map" aria-label="The ten steps of the token chain">
      {steps.map((s) => (
        <li key={s.id}>
          <button type="button" className="cm-step" data-state={s.state} data-testid={`chain-step-${s.id}`}
            aria-label={`Step ${s.n}, ${s.label}: ${STATE_WORD[s.state]}${s.hopN != null ? ". Opens the hop detail." : ""}`}
            disabled={s.hopN == null}
            aria-current={s.hopN != null && s.hopN === selectedHop ? "step" : undefined}
            onClick={() => s.hopN != null && onSelectStep?.(s.hopN)}>
            <span className="cm-n" aria-hidden="true">{s.n}</span>
            <b className="cm-label">{s.label}</b>
            <span className="cm-state">{STATE_WORD[s.state]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
