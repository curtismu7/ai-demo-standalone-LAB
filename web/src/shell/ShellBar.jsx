import { useEffect, useState } from "react";
import { setMode, getInfo } from "../api";
import TopMenu, { applyFontSize } from "../top-menu/TopMenu.jsx";

const ROUTES = [
  { id: "dashboard", href: "#/dashboard", label: "Dashboard" },
  { id: "use-cases", href: "#/use-cases", label: "Use Cases" },
  { id: "observability", href: "#/observability", label: "Observability" },
  { id: "guide", href: "#/guide", label: "Guide" },
  { id: "welcome", href: "#/welcome", label: "Welcome" },
  { id: "airline", href: "#/airline", label: "Airline" },
];
const THEMES = ["auto", "light", "dark"];
const SIZES = ["S", "M", "L"];

// ui-pattern: allow P3 the wide catalog frame is this lab's shipped layout until the P2 dashboard rebuild
export default function ShellBar({ route, onReset, presenter = false, onTogglePresenter, children }) {
  const [theme, setTheme] = useState(() => {
    try { const t = document.documentElement.dataset.theme; return ["auto", "light", "dark"].includes(t) ? t : "auto"; } catch { return "auto"; }
  });
  const [fontStep, setFontStep] = useState(() => { try { const f = localStorage.getItem("aidemo.font"); return SIZES.includes(f) ? f : "M"; } catch { return "M"; } });
  const [modeMsg, setModeMsg] = useState("");
  const [realAvailable, setRealAvailable] = useState(false);
  const [mode, setModeState] = useState("mock");

  useEffect(() => { getInfo().then((i) => { setRealAvailable(Boolean(i?.realAvailable)); setModeState(i?.mode || "mock"); }).catch(() => {}); }, []);

  // "auto" removes data-theme so the OS preference (tokens.css / main.jsx mirror) shows through.
  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("aidemo.theme", theme); } catch { /* not remembered */ }
  }, [theme]);
  useEffect(() => {
    applyFontSize(fontStep);
    try { localStorage.setItem("aidemo.font", fontStep); } catch { /* not remembered */ }
  }, [fontStep]);

  // Rule 19: clicking Real (or Mock) calls POST /api/mode. Real answers 409 while unconfigured;
  // when configured (AIDEMOLAB_REAL_*), Real activates the real PingOne exchange on the dashboard.
  const pickMode = async (source) => {
    const res = await setMode(source).catch(() => ({ ok: false, body: {} }));
    if (res.ok) setModeState(source);
    setModeMsg(res.ok
      ? (source === "real" ? "Switched to Real: the dashboard's Real PingOne exchange panel is active." : "Switched to Mock: everything is simulated again.")
      : res.body?.detail || "Real mode is not configured for this lab.");
  };

  return (
    <header className="shell-bar">
      <span className="shell-brand">
        <img className="shell-logo" src="/ping-logo.png" alt="Ping Identity" width="30" height="30" />
        <span aria-hidden="true">✈</span>
        AI Demo <span className="shell-badge" data-testid="mock-badge">{mode === "real" ? "REAL TOKENS" : "MOCK"}</span>
      </span>
      <nav className="shell-nav" aria-label="Sections">
        {ROUTES.map((r) => (
          <a key={r.id} href={r.href} data-testid={`nav-${r.id}`} aria-current={route === r.id ? "page" : undefined}>{r.label}</a>
        ))}
      </nav>
      <span className="shell-right">
        <TopMenu
          mode={{ value: mode === "real" ? "real" : "mock", onChange: pickMode, realAvailable, realHint: "Real mode is not configured for this lab" }}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={onTogglePresenter ? { active: presenter, onToggle: onTogglePresenter, label: "Presenter" } : undefined}
          help={{ href: "https://github.com/curtismu7/ai-demo-standalone-LAB#readme" }}
          version={null}
          onReset={onReset}
        >
          {children}
        </TopMenu>
      </span>
      {modeMsg && <p className="mode-msg" role="status" data-testid="mode-msg">{modeMsg}</p>}
    </header>
  );
}
