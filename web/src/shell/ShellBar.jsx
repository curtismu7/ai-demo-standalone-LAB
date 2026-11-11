import { useEffect, useState } from "react";
import { setMode, getInfo } from "../api";

const ROUTES = [
  { id: "dashboard", href: "#/dashboard", label: "Dashboard" },
  { id: "use-cases", href: "#/use-cases", label: "Use Cases" },
  { id: "guide", href: "#/guide", label: "Guide" },
  { id: "welcome", href: "#/welcome", label: "Welcome" },
];
const SIZES = [
  { id: "auto", label: "A" },
  { id: "large", label: "A+" },
];

// ui-pattern: allow P3 the wide catalog frame is this lab's shipped layout until the P2 dashboard rebuild
export default function ShellBar({ route, onReset, children }) {
  const [theme, setTheme] = useState(() => {
    try { return document.documentElement.dataset.theme || "light"; } catch { return "light"; }
  });
  const [size, setSize] = useState("auto");
  const [modeMsg, setModeMsg] = useState("");
  const [realAvailable, setRealAvailable] = useState(false);
  const [mode, setModeState] = useState("mock");

  useEffect(() => { getInfo().then((i) => { setRealAvailable(Boolean(i?.realAvailable)); setModeState(i?.mode || "mock"); }).catch(() => {}); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.fontSize = size === "large" ? "18px" : "";
  }, [size]);

  // Rule 19: clicking Real (or Mock) calls POST /api/mode. Real answers 409 while unconfigured;
  // when configured (AIDEMOLAB_REAL_*), Real activates the real PingOne exchange on the dashboard.
  const pickMode = async (source) => {
    const res = await setMode(source).catch(() => ({ ok: false, body: {} }));
    if (res.ok) setModeState(source);
    setModeMsg(res.ok
      ? (source === "real" ? "Switched to Real: the dashboard's Real PingOne exchange panel is active." : "Switched to Mock: everything is simulated again.")
      : res.body?.detail || "Real mode is not configured for this lab.");
  };
  const pickReal = () => pickMode("real");

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
        <span className="seg" role="group" aria-label="Data source" data-testid="mode-toggle">
          <button type="button" aria-pressed={mode !== "real"} data-testid="mode-mock" onClick={() => pickMode("mock")}>Mock</button>
          <button
            type="button"
            aria-pressed={mode === "real"}
            data-testid="mode-real"
            title={realAvailable ? "Real mode: the dashboard's Real PingOne exchange panel is active" : "Real mode is not configured for this lab"}
            onClick={pickReal}
          >Real</button>
        </span>
        <button type="button" data-testid="theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle dark mode" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        <button type="button" data-testid="text-size" aria-label="Text size" title="Text size" onClick={() => setSize((s) => (s === "auto" ? "large" : "auto"))}>
          {SIZES.find((s) => s.id === size)?.label}
        </button>
        {children}
        <button type="button" data-testid="demo-controls" disabled title="Demo controls arrive in a later phase">Demo Controls</button>
        {onReset && <button type="button" onClick={onReset} data-testid="reset">Reset</button>}
        <button type="button" data-testid="presenter" title="Presenter mode (P key)">Presenter</button>
      </span>
      {modeMsg && <p className="mode-msg" role="status" data-testid="mode-msg">{modeMsg}</p>}
    </header>
  );
}
