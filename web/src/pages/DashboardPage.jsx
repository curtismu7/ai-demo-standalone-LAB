// The one-page dashboard (plan phase P2): five stacked sections, jump tiles instead of
// Previous/Next. One prompt in section 1 fills every section below: the plan (section 2),
// the evidence (3), the products (4) and the talk track (5). The reply is always written
// from the run the server returns; the Scripted brain on the server decides WHAT runs.
// Airline copy everywhere; engine tool names stay as-is (renaming is plan phase P6).
import { useCallback, useEffect, useState } from "react";
import Json from "../components/Json";
import { assistantTurn } from "../api";
import { visible } from "../safeText";
import ChainView from "../components/ChainView.jsx";
import TokenCardsPanel from "../components/TokenCardsPanel.jsx";
import QuickConfigDialog, { readConfig } from "../components/QuickConfigDialog.jsx";

const GREETING = "Sign in with your customer account to access travel features: bookings, loyalty, flight changes, and more. Or ask me about OAuth, PKCE, MCP, or how AI agents work.";

// The 11 in-app chips: one per wired scenario. Airline wording where the copy allows —
// the matcher keys on intent, not on the tool name (which stays as the engine names it).
const CHIPS = [
  { prompt: "Check my travel account balance", label: "Balance read (delegated token)", ucId: "UC1" },
  { prompt: "Do I need MFA step-up for this change?", label: "MFA step-up", ucId: "UC7" },
  { prompt: "Who can approve a transfer? Human in the loop", label: "HITL approval", ucId: "UC8" },
  { prompt: "Am I in the required group for this fare?", label: "Group gate", ucId: "UC9" },
  { prompt: "Flip the directory entry and run it again", label: "Directory flip", ucId: "UC9A" },
  { prompt: "Can the agent use the premium wire tool?", label: "Premium tool gate", ucId: "UC21" },
  { prompt: "Promote me to the premium tier", label: "Tier promotion", ucId: "UC21" },
  { prompt: "Change 60000 miles — over the ceiling?", label: "Tier ceiling", ucId: "UC21" },
  { prompt: "An unknown agent tried to act for me", label: "Rogue agent", ucId: "UC6" },
  { prompt: "A token minted for the upstream MCP arrived here", label: "Upstream audience", ucId: "UC32" },
  { prompt: "Approve on my phone — out of band (CIBA)", label: "CIBA", ucId: "UC22" },
];

// The scenario runner's baseline rule, mirrored server-side: what the directory says
// before the run so a previous flip cannot poison the page.
const SEEDS = {
  premiumUser: { groups: ["privileged", "premiumTier"], tier: "Premium" },
  jane: { groups: [], tier: "Standard" },
  demoUser: { groups: ["privileged"], tier: "Standard" },
};

/** Jump tiles: hrefs + aria-current, smooth scroll. No Previous/Next anywhere. */
export function StepTiles({ active, idPrefix }) {
  const steps = [
    { n: 1, id: "signin", b: "Sign in & ask", small: "PingOne, the prompt" },
    { n: 2, id: "plan", b: "Agent & tools", small: "plan, pick the tool" },
    { n: 3, id: "evidence", b: "Evidence", small: "decision, hops, reel" },
    { n: 4, id: "products", b: "Products & why", small: "who enforced what" },
    { n: 5, id: "talk", b: "Talk track", small: "how to tell it" },
  ];
  return (
    <nav className="stepper" role="navigation" aria-label="Jump to a section" data-testid="step-tiles">
      {steps.map((s) => (
        <a key={s.id} className={`step${active === s.id ? " active" : ""}`} href={`#${idPrefix}-${s.id}`}
          aria-current={active === s.id ? "step" : undefined} data-testid={`step-${s.id}`}>
          <span className="n" aria-hidden="true">{s.n}</span><b>{s.b}</b><small>{s.small}</small>
        </a>
      ))}
    </nav>
  );
}

/** Section 1: composer + chips + the Direct dashboard run panel + the transcript. */
export function AssistantSection({ transcript, run, onSend, busy, fail, onChip }) {
  const [text, setText] = useState("");
  const submit = (e) => { e.preventDefault(); const t = text.trim(); if (!t || busy) return; onSend(t); setText(""); };
  const chip = run ? run.decision : null;
  const chipClass = chip === "PERMIT" ? "tag tag--ok" : chip === "OBLIGATION" ? "tag tag--warn" : chip ? "tag tag--deny" : "tag";
  return (
    <section className="panel lane lane-browser" id="dash-signin" aria-labelledby="dash-signin-h" data-testid="assistant-section">
      <h2 id="dash-signin-h">Sign in &amp; ask <span className="tag">Browser</span></h2>
      <p className="muted">You are signed in as <b>demoUser</b> (Standard tier). Everything below follows from the one prompt you type here.</p>
      <form className="composer" onSubmit={submit} data-testid="composer">
        <label className="sr-only" htmlFor="dash-ask">Ask the agent</label>
        <input id="dash-ask" type="text" maxLength={500} value={text} placeholder='e.g. "Do I need MFA step-up for this change?"'
          onChange={(e) => setText(e.target.value)} data-testid="dash-ask" />
        <button type="submit" className="primary" disabled={busy || !text.trim()} data-testid="dash-send">Send</button>
      </form>
      <div className="seg chips" role="group" aria-label="Suggested prompts" data-testid="dash-chips">
        {CHIPS.map((c) => (
          <button key={`${c.ucId}-${c.label}`} type="button" className="mini" disabled={busy} data-testid={`chip-${c.ucId}-${c.label}`}
            onClick={() => onChip(c.prompt)}>{c.label}</button>
        ))}
      </div>
      <div className="panel direct-run" data-testid="direct-run">
        <b>Direct dashboard run</b>
        {run ? (
          <p data-testid="direct-run-body">
            {visible(run.ucId || "")} · {visible(run.scenarioId || "")} —{" "}
            <span className="outcome-chip"><span className={chipClass}>{visible(run.decision)}</span>{" "}{visible(run.reason || "")}</span>
          </p>
        ) : <p className="muted" data-testid="direct-run-empty">Run a prompt (or a chip) and the run lands here.</p>}
      </div>
      <div className="transcript" data-testid="transcript" aria-live="polite">
        {transcript.map((t, i) => (
          <p key={i} className={t.who === "user" ? "msg msg--user" : "msg"}>
            <b>{t.who === "user" ? "You" : "Agent"}</b> {visible(t.text)}
          </p>
        ))}
      </div>
      {busy && <p className="muted" role="status" data-testid="dash-busy">Running the decision chain…</p>}
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

/** Section 2: the plan — the one tool call, the brain label, the token-exchange line. */
export function PlanSection({ run }) {
  if (!run) return (
    <section className="panel" id="dash-plan" aria-labelledby="dash-plan-h" data-testid="plan-section">
      <h2 id="dash-plan-h">Agent &amp; tools <span className="tag">Agent</span></h2>
      <p className="muted">The agent's plan for the last run shows here.</p>
    </section>
  );
  const args = { amount: run.amount ?? null };
  return (
    <section className="panel" id="dash-plan" aria-labelledby="dash-plan-h" data-testid="plan-section">
      <h2 id="dash-plan-h">Agent &amp; tools <span className="tag">Agent</span></h2>
      <p data-testid="plan-line">The agent planned one tool call: <code>{visible(run.tool)}</code> — brain: <b data-testid="brain-label">Scripted</b></p>
      <Json value={{ tool: run.tool, args, decision: run.decision, code: run.code ?? null }} label="The tool-call plan" />
      <p className="muted" data-testid="token-exchange-line">Token exchange (RFC 8693): the delegated token carries <code>sub={visible(run.user)}</code>, <code>act={"{ sub: "}{visible(run.act?.sub || "(none)")}"}</code> — the consent exchange is the only place <code>act</code> is minted.</p>
    </section>
  );
}

/** Section 3: three columns — Authorize decision / the hops / the movie-reel placeholder (P3). */
export function EvidenceSection({ run, cfg }) {
  return (
    <section className={`tri${cfg?.theme === "white" ? " tri--white" : ""}`} id="dash-evidence" aria-label="Evidence" data-testid="evidence-section">
      <div className="panel lane lane-authorize">
        <h2 id="dash-ev-h">Authorize decision</h2>
        {run ? (
          <>
            <p><span className={`outcome-chip tag ${run.decision === "PERMIT" ? "tag--ok" : run.decision === "OBLIGATION" ? "tag--warn" : "tag--deny"}`} data-testid="evidence-decision">{visible(run.decision)}</span> {visible(run.code || "")}</p>
            <p className="muted" data-testid="evidence-reason">{visible(run.reason || "")}</p>
          </>
        ) : <p className="muted">Decision and reason show here after a run.</p>}
      </div>
      <div className="panel lane lane-gateway">
        <h2>Chain</h2>
        <ChainView hops={run?.hops || []} cfg={cfg} />
      </div>
      <div className="panel lane lane-mcp">
        <h2>Tokens</h2>
        <TokenCardsPanel tokens={run?.tokens || []} />
      </div>
    </section>
  );
}

/** Section 4: the product cards + the why callout. */
export function ProductsSection({ run }) {
  return (
    <section className="panel" id="dash-products" aria-labelledby="dash-prod-h" data-testid="products-section">
      <h2 id="dash-prod-h">Products &amp; why</h2>
      <p className="muted">Who enforced what in this run — the buyer story on one screen.</p>
      {run?.products?.length ? (
        <div className="prod" data-testid="product-cards">
          {run.products.map((p) => (
            <div key={p.product} className="card">
              <h3>{visible(p.product)}</h3>
              <p><b>{visible(p.role)}.</b> {visible(p.does)}</p>
            </div>
          ))}
        </div>
      ) : <p className="muted" data-testid="product-cards-empty">The product cast of the run shows here.</p>}
      {run && (
        <div className="panel direct-run why-callout" data-testid="why-callout">
          <b>{run.decision === "PERMIT" ? "Why it was allowed" : run.decision === "OBLIGATION" ? "Why it was paused" : "Why it was blocked"}</b>
          <p>{visible(run.reason || "")}{run.lesson ? <> <span className="muted">{visible(run.lesson)}</span></> : null}</p>
        </div>
      )}
    </section>
  );
}

/** Section 5: the run's 3-beat narrative (the engine's explain layer). */
export function TalkTrackSection({ run }) {
  const beats = run?.narrative?.length ? run.narrative : null;
  return (
    <section className="panel tt" id="dash-talk" aria-labelledby="dash-talk-h" data-testid="talk-section">
      <h2 id="dash-talk-h">Talk track</h2>
      {beats ? (
        <ol className="facts" data-testid="talk-beats">
          {beats.map((n, i) => <li key={n.title}><b>{visible(n.title)}.</b> {visible(n.what)}</li>)}
        </ol>
      ) : <p className="muted" data-testid="talk-empty">The three-beat story of the run appears here.</p>}
      {run?.lesson && <p className="lesson" data-testid="talk-lesson"><strong>The lesson.</strong> {visible(run.lesson)}</p>}
    </section>
  );
}

const SECTIONS = ["signin", "plan", "evidence", "products", "talk"];

export default function DashboardPage({ story }) {
  const [transcript, setTranscript] = useState([{ who: "agent", text: GREETING }]);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(null);
  const [active, setActive] = useState("signin");
  const [qcOpen, setQcOpen] = useState(false);
  const [cfg, setCfg] = useState(() => readConfig());
  const onCfg = useCallback((key, value) => setCfg((c) => ({ ...c, [key]: value })), []);

  const send = useCallback(async (message) => {
    setBusy(true); setFail(null);
    setTranscript((t) => [...t, { who: "user", text: message }]);
    const r = await assistantTurn(message).catch(() => ({ ok: false, body: {} }));
    setBusy(false);
    if (!r.ok || !r.body.reply) { setFail(r.body.detail || "The assistant could not answer. Is the server running?"); return; }
    const reply = r.body.reply;
    setTranscript((t) => [...t, { who: reply.by === "agent" ? "agent" : reply.by, text: reply.text }]);
    if (r.body.run) setRun(r.body.run);
  }, []);

  // The obligation pause is answered through the EXISTING Use Cases runner (challenge +
  // challenge/answer + re-run live there); the dashboard points the visitor at it.
  const onChip = useCallback((prompt) => send(prompt), [send]);

  useEffect(() => {
    const on = () => {
      const fromTop = window.scrollY + 120;
      let cur = SECTIONS[0];
      for (const id of SECTIONS) {
        const el = document.getElementById(`dash-${id}`);
        if (el && el.offsetTop <= fromTop) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // scenario seeds stay reachable from the header chips (Use Cases owns the full runner)
  const seeds = story?.scenarios ?? [];
  void seeds; void SEEDS; // (the server seeds the directory; kept in sync by /assistant/turn)

  return (
    <div className={`dashboard-page${cfg.theme === "white" ? " dashboard-page--white" : ""}`} data-theme={cfg.theme === "white" ? "light" : "dark"} data-testid="dashboard-page" style={{ fontSize: `${1 + Number(cfg.size) * 0.06}rem` }}>
      <h1>Customer dashboard</h1>
      <p className="muted">Ask the airline agent, watch each authorization step, and see the evidence behind every answer — one step at a time.</p>
      <StepTiles active={active} idPrefix="dash" />
      <div className="dash-qc-row">
        <button type="button" className="dash-qc-btn" onClick={() => setQcOpen(true)} data-testid="qc-open">Demo controls</button>
      </div>
      <AssistantSection transcript={transcript} run={run} onSend={send} onChip={onChip} busy={busy} fail={fail} />
      <PlanSection run={run} />
      <EvidenceSection run={run} cfg={cfg} />
      <ProductsSection run={run} />
      <TalkTrackSection run={run} />
      <p className="muted">Run a real use case from <a href="#/use-cases">Use Cases</a> to fill these sections — including resolving an obligation (consent, MFA, CIBA) with its receipt.</p>
      <QuickConfigDialog isOpen={qcOpen} onClose={() => setQcOpen(false)} config={cfg} onChange={onCfg} />
    </div>
  );
}
