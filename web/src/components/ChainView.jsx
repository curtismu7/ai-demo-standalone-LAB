import { useEffect, useMemo, useState } from "react";
import MovieReel, { SPEEDS } from "../evidence/MovieReel.jsx";
import SequenceView from "../evidence/SequenceView.jsx";
import StepDetailPanel from "../evidence/StepDetailPanel.jsx";
import { actorsIn, withSkipped } from "../evidence/lanes.js";
import { readPref, writePref } from "../evidence/lanes.js";
import "./ChainView.css";

// P3 chain view: the vendored evidence components over the run's demo-hop/1 hops.
// Views: Reel (movie reel) / Sequence (the swimlane) / Detail is opened by a click in either.
// The slim rule keeps exactly these views — no extra chrome.

const PREF_VIEW = "cal.dash.chain.view";
const PREF_SKIPPED = "cal.dash.chain.skipped";

const VIEWS = [
  { id: "reel", label: "Reel" },
  { id: "sequence", label: "Sequence" },
];

export default function ChainView({ hops = [] }) {
  const [view, setView] = useState(() => readPref(PREF_VIEW, (v) => VIEWS.some((x) => x.id === v), "reel"));
  const [selected, setSelected] = useState(null);
  const [skipped, setSkipped] = useState(() => readPref(PREF_SKIPPED, (v) => v === true || v === "true", true));
  const actors = useMemo(() => actorsIn(hops), [hops]);
  const shown = useMemo(() => withSkipped(hops, skipped), [hops, skipped]);

  useEffect(() => { setSelected(null); }, [hops]);

  const pick = (n) => setSelected(n === selected ? null : n);

  if (!hops.length) {
    return <p className="muted" data-testid="chain-empty">The live trace of the run lands here: a movie reel of every API exchange, each one clickable.</p>;
  }

  return (
    <div className="chainv" data-testid="chain-view">
      <div className="chainv__bar">
        <div className="seg" role="group" aria-label="Chain view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "on" : ""}
              onClick={() => { setView(v.id); writePref(PREF_VIEW, v.id); }}
              data-testid={`chain-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="chainv__skip">
          <input
            type="checkbox"
            checked={skipped}
            onChange={(e) => { setSkipped(e.target.checked); writePref(PREF_SKIPPED, e.target.checked); }}
          />
          Show skipped
        </label>
      </div>
      {view === "reel"
        ? <MovieReel hops={shown} selected={selected} onSelect={pick} />
        : <SequenceView hops={shown} selected={selected} onSelect={pick} actors={actors} />}
      <StepDetailPanel hops={shown} selected={selected} onSelect={pick} onClose={() => setSelected(null)} />
    </div>
  );
}

export { SPEEDS };
