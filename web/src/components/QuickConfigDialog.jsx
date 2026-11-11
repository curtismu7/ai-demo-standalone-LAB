import { useEffect, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog.jsx";
import { readPref, writePref } from "../evidence/lanes.js";
import "./QuickConfigDialog.css";

// P4 Quick Config: the lab-own dialog on the vendored FloatingDialog that controls which
// evidence view the chain card renders and how. Slim per the plan: theme (Black | White),
// text size (A- | A+), the view cards, and the per-view controls. The chosen state persists
// (localStorage via the same lanes helpers) and DashboardPage reads it back.

const PREF = {
  theme: "cal.dash.cfg.theme",
  size: "cal.dash.cfg.size",
  view: "cal.dash.cfg.view",
  surface: "cal.dash.cfg.surface",
  rfc: "cal.dash.cfg.rfc",
  follow: "cal.dash.cfg.follow",
  slow: "cal.dash.cfg.slow",
};

// The view cards: which evidence component the Token Chain card renders. "Server flow" is
// the sequence view plus the reel stacked (lab-own composition); "Token topology" is not
// offered — the lab has no topology renderer.
export const VIEW_CARDS = [
  { id: "reel", label: "Movie reel", blurb: "One frame per hop; plays on a timer." },
  { id: "sequence", label: "Sequence view", blurb: "The swimlane: lanes, arrows, verdicts." },
  { id: "server-flow", label: "Server flow", blurb: "Sequence view and reel, stacked." },
  { id: "stepper", label: "Simple stepper", blurb: "Numbered steps, minimal chrome." },
];

const SURFACES = [
  { id: "embedded", label: "Embedded" },
  { id: "popout", label: "Pop-out" },
  { id: "both", label: "Both" },
];

const load = (key, ok, fallback) => readPref(key, ok, fallback);

export function readConfig() {
  return {
    theme: load(PREF.theme, (v) => v === "black" || v === "white", "black"),
    size: load(PREF.size, (v) => /^-?[12]$/.test(v), "0"),
    view: load(PREF.view, (v) => VIEW_CARDS.some((c) => c.id === v), "reel"),
    surface: load(PREF.surface, (v) => SURFACES.some((s) => s.id === v), "embedded"),
    rfc: load(PREF.rfc, (v) => v === true || v === "true", false),
    follow: load(PREF.follow, (v) => v === true || v === "true", true),
    slow: load(PREF.slow, (v) => v === true || v === "true", false),
  };
}

function SegGroup({ label, options, value, onChange, testId }) {
  return (
    <div className="qc__group" role="group" aria-label={label}>
      <h4>{label}</h4>
      <div className="qc__seg" data-testid={testId}>
        {options.map((o) => (
          <button key={o.id} type="button" className={value === o.id ? "on" : ""} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange, testId }) {
  return (
    <label className="qc__check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

export default function QuickConfigDialog({ isOpen, onClose, config, onChange }) {
  const set = (key, ok, value) => { if (ok(value)) { writePref(PREF[key], value); onChange(key, value); } };

  // Focus returns to the opener on close: FloatingDialog restores focus itself when given
  // a closeLabel button, so nothing extra is needed here — but Esc must always close.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Demo controls"
      ariaLabel="Demo controls"
      testId="quick-config"
      storageKey="cal.dash.qc.geo"
      defaultWidth={430}
      defaultHeight={560}
      noBackdrop
    >
      <div className="qc" data-testid="quick-config-body">
        <SegGroup
          label="Theme"
          testId="qc-theme"
          options={[{ id: "black", label: "Black" }, { id: "white", label: "White" }]}
          value={config.theme}
          onChange={(v) => set("theme", (x) => x === "black" || x === "white", v)}
        />
        <div className="qc__group" role="group" aria-label="Text size">
          <h4>Text size</h4>
          <div className="qc__seg" data-testid="qc-size">
            {["-2", "-1", "0", "1", "2"].map((n) => (
              <button key={n} type="button" className={config.size === n ? "on" : ""} aria-pressed={config.size === n} onClick={() => set("size", (x) => /^-?[12]$/.test(x), n)}>
                {n === "0" ? "A" : n.startsWith("-") ? `A${n.replace("-", "-").slice(0, 2)}` : `A+${n}`}
              </button>
            ))}
          </div>
        </div>
        <div className="qc__group">
          <h4>Evidence view</h4>
          <div className="qc__cards" data-testid="qc-views">
            {VIEW_CARDS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`qc__card${config.view === c.id ? " on" : ""}`}
                aria-pressed={config.view === c.id}
                onClick={() => set("view", (x) => VIEW_CARDS.some((y) => y.id === x), c.id)}
                data-testid={`qc-view-${c.id}`}
              >
                <b>{c.label}</b>
                <span>{c.blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <SegGroup
          label="Surface"
          testId="qc-surface"
          options={SURFACES}
          value={config.surface}
          onChange={(v) => set("surface", (x) => SURFACES.some((s) => s.id === x), v)}
        />
        <div className="qc__toggles">
          <Check label="RFC info on steps" checked={config.rfc} onChange={(v) => set("rfc", Boolean, v)} testId="qc-rfc" />
          <Check label="Follow the flow" checked={config.follow} onChange={(v) => set("follow", Boolean, v)} testId="qc-follow" />
          <Check label="Slow mode" checked={config.slow} onChange={(v) => set("slow", Boolean, v)} testId="qc-slow" />
        </div>
      </div>
    </FloatingDialog>
  );
}

export { PREF as QUICK_CONFIG_PREFS };
