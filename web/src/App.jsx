import { useCallback, useEffect, useState } from "react";
import PolicyGate from "./components/PolicyGate";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import ReturnLink from "./return-link/ReturnLink.jsx";
import ShellBar from "./shell/ShellBar.jsx";
import SimBanner from "./shell/SimBanner.jsx";
import WelcomePage from "./pages/WelcomePage.jsx";
import ObservabilityPage from "./pages/ObservabilityPage.jsx";
import UseCasesPage from "./pages/UseCasesPage.jsx";
import DashboardOnePage from "./pages/DashboardPage.jsx";
import { readReturnContext } from "./return-link/returnTargets.js";
import { scenarioFor } from "./handoffMap";
import { takeReturn } from "./returned";
import { getJson, resetWorkspace } from "./api";
export const ROUTES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "use-cases", label: "Use Cases" },
  { id: "observability", label: "Observability" },
  { id: "guide", label: "Guide" },
  { id: "welcome", label: "Welcome" },
];
const DIAGRAM_ROUTE = "diagram"; // the stage-1 diagram view stays reachable under #/diagram (noted in the P1 PR)

const hashRoute = () => {
  const h = window.location.hash.replace(/^#\/?/, "");
  const m = /^scenario-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { route: "use-cases", scenario: m[1] };
  if (h === DIAGRAM_ROUTE) return { route: DIAGRAM_ROUTE, scenario: null };
  return { route: ROUTES.some((r) => r.id === h) ? h : "dashboard", scenario: null };
};

// ui-pattern: allow P3 the dashboard frame is the wide catalog layout this lab ships with; P3 narrows it in a later phase
export default function App() {
  // Opened from Customer Agent LAB: preselect the matching scenario (handoffMap.js), once, on load.
  const [handoff] = useState(() => readReturnContext(window.location.search));
  // Came Back from a lab this page handed off to (?returned=<app>&uc=<id>): open the Use
  // Cases page with that use case preselected. takeReturn() also strips the two parameters
  // from the address bar. Ids only; an unknown app or a malformed id is ignored entirely.
  const [returned] = useState(() => takeReturn());
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [route, setRoute] = useState(hashRoute().route);
  const [requested, setRequested] = useState(() => hashRoute().scenario || scenarioFor(handoff));
  // Back from a hand-off: open the Use Cases page with the returned use case preselected
  // (the launcher shows its chip; the visitor has already seen the run once).
  useEffect(() => {
    if (!returned) return;
    setRoute("use-cases");
    setRequested(returned.uc);
  }, []); // once, on load
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");

  useEffect(() => { getJson("/api/scenarios").then((j) => { setStory(j); setError(null); }, (e) => setError(e.message)); }, []);
  const hashGuard = { handled: false };
  useEffect(() => {
    const on = () => { if (hashGuard.handled) return; hashGuard.handled = true; const p = hashRoute(); setRoute((r) => (p.route === r ? r : p.route)); setRequested((v) => (p.scenario === v ? v : p.scenario)); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const pickScenario = (sid) => { try { window.history.replaceState(null, "", `#/scenario-${sid}`); } catch { /* ignore */ } };
  // P5 launcher: "Runs here" goes to the dashboard with the use case preselected; the
  // dashboard's assistant turn runs it (the same entry path a chip takes).
  const runHere = (ucId) => {
    setRoute("dashboard");
    setRequested((v) => (v === ucId ? v : ucId));
    try { window.history.replaceState(null, "", "#/dashboard"); } catch { /* ignore */ }
  };

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's directory flips and runs are back to defaults." : "Reset failed on the server; the view was reset.");
  }, []);

  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <ShellBar route={route} onReset={reset} presenter={presenter} onTogglePresenter={() => setPresenter((v) => !v)}>
        <ReturnLink app="ai-demo-standalone" variant="header" />
      </ShellBar>
      <main>
        <SimBanner />
        <ReturnLink app="ai-demo-standalone" />
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        {error ? <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p> : !story ? <p className="muted">Loading...</p> : (
          <>
            {presenter && route !== "guide" && (
              <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                {story.talkTrack.filter((t) => (route === "dashboard" || route === "use-cases" ? ["say-first", "one-engine", "groups", "tiers", "who-acting", "unverified"] : ["say-first"]).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
              </aside>
            )}
            {route === "dashboard" && <DashboardPage story={story} requestedUc={route === "dashboard" && requested && /^UC/.test(requested) ? requested : null} />}
            {route === "use-cases" && <UseCasesPage story={story} resetSignal={resetSignal} requestedId={requested} onSelect={pickScenario} onRunHere={runHere} />}{route === "guide" && <GuidePage story={story} resetSignal={resetSignal} />}
            {route === "observability" && <ObservabilityPage />}
            {route === "welcome" && <WelcomePage />}
            {route === DIAGRAM_ROUTE && <DiagramRoute resetSignal={resetSignal} />}
          </>
        )}
      </main>
    </div>
  );
}

// The dashboard route is the P2 one-page layout; the guided-walk runner stays reachable on
// the Use Cases tab (the full scenario list, tabs and obligation resolution live there).
function DashboardPage({ story }) {
  return <DashboardOnePage story={story} />;
}

// The Guide page: the diagram view plus the talk track, under one h1.
function GuidePage({ story, resetSignal }) {
  return (
    <>
      <h1>Guide</h1>
      <DiagramTab resetSignal={resetSignal} />
      <TalkTrack talk={story.talkTrack} />
    </>
  );
}

// The stage-1 diagram tab keeps its own view under #/diagram so nothing is lost; the Guide page renders it too.
function DiagramRoute({ resetSignal }) {
  return (
    <>
      <h1>Diagram</h1>
      <DiagramTab resetSignal={resetSignal} />
    </>
  );
}
