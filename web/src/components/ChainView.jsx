import { useEffect, useMemo, useState } from "react";
import MovieReel, { SPEEDS } from "../evidence/MovieReel.jsx";
import SequenceView from "../evidence/SequenceView.jsx";
import StepDetailPanel from "../evidence/StepDetailPanel.jsx";
import { actorsIn, withSkipped } from "../evidence/lanes.js";
import { readPref, writePref } from "../evidence/lanes.js";
import "./ChainView.css";

// P3 chain view: the vendored evidence components over the run's demo-hop/1 hops.
// P4: the Quick Config dialog chooses the view and the pace — cfg.view ("reel",
// "sequence", "server-flow" = both stacked, "stepper" = the compact numbered list),
// cfg.follow (auto-advance the reel) and cfg.slow (longest frame time) flow in here.
// The slim rule keeps exactly these views — no extra chrome.

const PREF_SKIPPED = "cal.dash.chain.skipped";

const VIEWS = [
  { id: "reel", label: "Reel" },
  { id: "sequence", label: "Sequence" },
];

export default function ChainView({ hops = [], cfg = null }) {
  const [localView, setLocalView] = useState(() => readPref("cal.dash.chain.view", (v) => VIEWS.some((x) => x.id === v), "reel"));
  const [selected, setSelected] = useState(null);
  const [skipped, setSkipped] = useState(() => readPref(PREF_SKIPPED, (v) => v === true || v === "true", true));
  const actors = useMemo(() => actorsIn(hops), [hops]);
  const shown = useMemo(() => withSkipped(hops, skipped), [hops, skipped]);

  // cfg.view wins when Quick Config is wired; the inline toggle stays for the unwired case.
  const view = cfg?.view === "sequence" || cfg?.view === "server-flow" ? "sequence" : cfg?.view === "reel" || cfg?.view === "stepper" ? cfg.view : localView;

  useEffect(() => { setSelected(null); }, [hops]);

  const pick = (n) => setSelected(n === selected ? null : n);

  if (!hops.length) {
    return <p className="muted" data-testid="chain-empty">The live trace of the run lands here: a movie reel of every API exchange, each one clickable.</p>;
  }

  const stepper = view === "stepper";
  return (
    <div className={`chainv${cfg?.theme === "white" ? " chainv--white" : ""}`} data-testid="chain-view" data-view={cfg?.view || view}>
      {!stepper && (
        <div className="chainv__bar">
          {!cfg && (
            <div className="seg" role="group" aria-label="Chain view">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={view === v.id ? "on" : ""}
                  onClick={() => { setLocalView(v.id); writePref("cal.dash.chain.view", v.id); }}
                  data-testid={`chain-view-${v.id}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <label className="chainv__skip">
            <input
              type="checkbox"
              checked={skipped}
              onChange={(e) => { setSkipped(e.target.checked); writePref(PREF_SKIPPED, e.target.checked); }}
            />
            Show skipped
          </label>
        </div>
      )}
      {stepper ? (
        <ol className="chainv__steps" data-testid="chain-stepper">
          {shown.map((h) => (
            <li key={h.n}>
              <button type="button" onClick={() => pick(h.n)} aria-expanded={selected === h.n}>
                <b>{h.n}</b> {h.title || h.label} <span className="chainv__fact">{h.fact || ""}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : view === "reel" ? (
        <MovieReel hops={shown} selected={selected} onSelect={pick} />
      ) : (
        <div className={cfg?.view === "server-flow" ? "chainv__stack" : undefined}>
          <SequenceView hops={shown} selected={selected} onSelect={pick} actors={actors} />
          {cfg?.view === "server-flow" && <MovieReel hops={shown} selected={selected} onSelect={pick} />}
        </div>
      )}
      <StepDetailPanel hops={shown} selected={selected} onSelect={pick} onClose={() => setSelected(null)} />
    </div>
  );
}

export { SPEEDS };
