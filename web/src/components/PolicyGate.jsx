import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import { authorize, consent, getCatalog, getDirectory, setDirectory, challenge, answerChallenge, a2aExchangeOne, a2aExchangeTwo, a2aTool, a2aRegistry, a2aRegistrySet, getAttacks, runAttack } from "../api";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };
/** Which Ping product plays each productRole in the catalog. */
const ROLE_PRODUCT = { idp: "PingFederate (IdP)", gw: "PingGateway (gateway/PEP)", pdp: "PingOne Authorize (PDP)", pep: "PingGateway (PEP)", authz: "PingOne Authorize (PDP)", pa: "PingOne Privilege" };

/** Catalog data for one use case, in the facts shape (status: measured = from the dashboard's own config). */
export function useCaseFacts(uc) {
  const facts = [
    { id: "expected", status: "measured", text: `Expected outcome: ${uc.expectedOutcome || "?"} on the ${uc.track} track (maturity: ${uc.maturity || "?"}).`, source: "AI-DEMO2 config/useCases.js" },
  ];
  if (uc.owasp?.threats?.length) facts.push({ id: "owasp-threats", status: "measured", text: `OWASP AI threats covered: ${uc.owasp.threats.join(", ")}${uc.owasp.sections?.length ? ` (sections ${uc.owasp.sections.join(", ")})` : ""}.`, source: "AI-DEMO2 config/useCases.js" });
  if (uc.pingOneSolution) facts.push({ id: "solution", status: "measured", text: uc.pingOneSolution, source: "AI-DEMO2 config/useCases.js" });
  if (uc.primaryTool) facts.push({ id: "tool", status: "measured", text: `Primary gated tool: ${uc.primaryTool}.`, source: "AI-DEMO2 config/useCases.js" });
  facts.push({ id: "runs-in", status: "inferred", text: `Runs live in stage ${["foundations", "controls"].includes(uc.track) ? "1" : "2\u20134"} — the same mock PDP decides it.`, source: "this lab's stage plan" });
  return facts;
}

/** The whole dashboard as one catalog: every use case, grouped by track, with a run panel. */
export function CatalogList({ catalog, onSelect, selectedUc }) {
  const byTrack = new Map();
  for (const u of catalog.useCases) {
    if (!byTrack.has(u.track)) byTrack.set(u.track, []);
    byTrack.get(u.track).push(u);
  }
  return (
    <section className="panel" aria-labelledby="cat-h" data-testid="catalog">
      <h2 id="cat-h">Use-case catalog <span className="muted">{catalog.count} use cases, {byTrack.size} tracks</span></h2>
      <p className="muted">Stage 1 runs the foundations and controls scenarios live (chips below the run panel). Every other row is catalog data with its expected outcome — wired to the engine in stages 2–4.</p>
      {[...byTrack.entries()].map(([track, ucs]) => (
        <div key={track} className="catalog-track">
          <h3>{track} <span className="muted">({ucs.length})</span></h3>
          <ul className="catalog-list" data-testid={`track-${track}`}>
            {ucs.map((u) => (
              <li key={u.id} className={selectedUc === u.id ? "catalog-row selected" : "catalog-row"}>
                <button type="button" onClick={() => onSelect(u)} data-testid={`uc-${u.id}`}>
                  <strong>{u.id}</strong> {visible(u.title)} <span className="muted">— {visible(u.expectedOutcome || "?")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The detail panel for a selected use case: what it teaches, who it's for, where it lands. */
export function UseCaseDetail({ uc, onClose }) {
  if (!uc) return null;
  const roles = uc.productRoles || {};
  const roleRows = [['idp', roles.idp], ['gw', roles.gw], ['pdp', roles.pdp], ['pep', roles.pep], ['authz', roles.authz], ['pa', roles.pa]].filter(([, v]) => v);
  return (
    <section className="panel" aria-labelledby="ucd-h" data-testid="uc-detail">
      <h2 id="ucd-h">{visible(uc.id)}: {visible(uc.title)}</h2>
      <p className="muted">{visible(uc.oneLiner || "")}</p>
      <p><span className="tag">track: {visible(uc.track)}</span> <span className="tag">expected: {visible(uc.expectedOutcome || "?")}</span> <span className="tag">{visible(uc.maturity || "")}</span></p>
      {uc.whatLong && <p data-testid="ucd-what">{visible(uc.whatLong)}</p>}
      {uc.businessValue && <p><strong>Business value.</strong> {visible(uc.businessValue)}</p>}
      {uc.buyerStory && <p><strong>Buyer story.</strong> {visible(uc.buyerStory)}</p>}
      {roleRows.length > 0 && (
        <ul className="facts" data-testid="ucd-roles">
          {roleRows.map(([k, v]) => <li key={k}><strong>{ROLE_PRODUCT[k] || k}.</strong> {visible(v)}</li>)}
        </ul>
      )}
      {uc.pingOneSolution && <p data-testid="ucd-solution"><strong>Which product.</strong> {visible(uc.pingOneSolution)}</p>}
      {(uc.whatLong || uc.businessValue) && <p className="muted">Runs live in stage {["foundations", "controls"].includes(uc.track) ? "1" : "2–4"} — the same engine decides it.</p>}
      <button type="button" onClick={onClose} data-testid="ucd-close">Close</button>
    </section>
  );
}

const WORDS = {
  PERMIT: ["allow", "PERMITTED — the policy allows this call; it executed, fully attributable"],
  DENY: ["deny", "DENIED — the call was refused; nothing executed"],
  OBLIGATION: ["obligation", "PAUSED — the policy returned an obligation; the agent cannot proceed until the human resolves it"],
};

export function Verdict({ run }) {
  if (!run) return <p className="muted" data-testid="verdict-empty">Run a scenario to see the decision.</p>;
  const [cls, word] = WORDS[run.decision] || ["deny", run.decision];
  const stageText = run.stage === "protocol" ? "the PROTOCOL answered (401 before anything else)"
    : run.stage === "gateway" ? "the GATEWAY refused the chain"
    : "the POLICY decided";
  return (
    <div className={`verdict verdict--${cls}`} data-testid="verdict" role="status">
      <strong className="verdict__word">{word}</strong>
      {run.stage && <p className="muted" data-testid="stage">Stage: {stageText}</p>}
      {run.reason && <p className="reason" data-reason="policy">{visible(run.reason)}</p>}
      {run.user && (
        <p data-testid="who">
          Token: sub=<code>{visible(run.user)}</code>, act=<code>{visible(run.act?.sub || "(none)")}</code>
          {" "}— groups [ {(run.groups || []).join(", ") || "none"} ], tier {visible(run.tier || "Standard")}
        </p>
      )}
      {run.stages && <p className="muted" data-testid="stages">{run.stages.join(" · ")}</p>}
      {run.narrative?.map((n) => (
        <div key={n.title} className="narrative-step" data-testid="narrative">
          <h3>{visible(n.title)}</h3>
          <p>{visible(n.what)}</p>
        </div>
      ))}
      {run.lesson && <p className="lesson" data-testid="lesson-run"><strong>The lesson.</strong> {visible(run.lesson)}</p>}
      {run.products?.length > 0 && (
        <ul className="facts" data-testid="products">
          {run.products.map((p) => <li key={p.product}><strong>{visible(p.product)}</strong> ({visible(p.role)}): {visible(p.does)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The mock HTTP exchanges behind the run: raw request/response + traceparent, expandable. */
export function Hops({ hops, traceId }) {
  if (!hops?.length) return null;
  return (
    <section aria-label="Mock API exchanges with traceparent" data-testid="hops">
      <h3>Tech proof — the API exchanges <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {visible(h.label)}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}


const OTP = "123123"; // the mock MFA code, same as AI-DEMO2's demo MFA

/** Stage 2: resolve an obligation — consent tap, MFA OTP, CIBA approve — and re-run the call with the receipt. */
export function ObligationPanel({ run, onResolved }) {
  const [state, setState] = useState("idle"); // idle | challenge | answering | receipt
  const [challengeData, setChallengeData] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [fail, setFail] = useState(null);
  const ob = run?.obligation;
  if (!run || run.decision !== "OBLIGATION" || !ob) return null;
  const needsMfa = ob === "STEP_UP";
  const isCiba = ob === "CIBA";
  const isHitl = ob === "HITL_CONSENT";
  const raise = async () => {
    setFail(null); setState("challenge");
    const c = await challenge({ user: run.user, tool: run.tool, amount: run.amount ?? undefined }).catch(() => ({ ok: false, body: {} }));
    const chosen = c;
    if (!chosen.ok || !chosen.body.challenge) { setFail(chosen.body.detail || "Could not raise the challenge."); setState("idle"); return; }
    setChallengeData(chosen.body.challenge);
  };
  const resolve = async (answer) => {
    setFail(null); setState("answering");
    const a = await answerChallenge({ challenge: challengeData, answer }).catch(() => ({ ok: false, body: {} }));
    if (!a.ok || !a.body.receipt) { setFail(a.body.detail || a.body.error || "Could not verify."); setState("challenge"); return; }
    setReceipt(a.body.receipt); setState("receipt");
  };
  const rerun = async () => {
    setFail(null);
    // re-consent for a fresh token, then authorize with the receipt
    const c = await consent({ user: run.user, actor: run.act?.sub || "demo-agent" }).catch(() => ({ ok: false, body: {} }));
    if (!c.ok) { setFail("Could not mint the token."); return; }
    const payload = { token: c.body.token, tool: run.tool, amount: run.amount ?? undefined, receipt, ucId: run.ucId };
    const res = await authorize(payload).catch(() => ({ ok: false, body: {} }));
    if (res.body.decision) onResolved(res.body); else setFail(res.body.detail || "Could not re-evaluate.");
  };
  return (
    <section className="panel" aria-labelledby="ob-h" data-testid="obligation-panel">
      <h2 id="ob-h">Human in the loop <span className="muted">{ob}</span></h2>
      {isHitl && <p className="muted">This tool always requires human approval — the agent pauses and surfaces this modal. An approval is never an MFA.</p>}
      {needsMfa && <p className="muted">Consent + MFA at this band. The agent cannot self-approve; the human completes the challenge.</p>}
      {isCiba && <p className="muted">No browser to prompt in: the backend calls bc-authorize and the user approves out-of-band on their device (mock auth_req_id: <code>{challengeData?.authReqId || "—"}</code>).</p>}
      {state === "idle" && <button type="button" onClick={raise} data-testid="ob-raise">Surface the {ob} challenge</button>}
      {state === "challenge" && (
        <div className="seg" role="group" aria-label="Resolve the challenge">
          <button type="button" data-testid="ob-consent" onClick={() => resolve(needsMfa ? { consent: true, otp: null } : isCiba ? {} : { consent: true })} disabled={!needsMfa && !isCiba && false}>
            Approve (consent)
          </button>
          {needsMfa && <button type="button" data-testid="ob-mfa" onClick={() => resolve({ consent: true, otp: OTP })}>Complete MFA (OTP {OTP})</button>}
          {isCiba && <button type="button" data-testid="ob-ciba" onClick={() => resolve({ cibaApproved: true })}>Approve on device (CIBA)</button>}
        </div>
      )}
      {state === "receipt" && (
        <div>
          <p data-testid="ob-receipt">Receipt <code>{receipt.receiptId.slice(0, 18)}…</code> bound to this exact call ({Object.entries(receipt.claims).map(([k, v]) => `${k}=${v}`).join(", ")}).</p>
          <button type="button" onClick={rerun} data-testid="ob-rerun">Re-evaluate the SAME call with the receipt</button>
        </div>
      )}
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

/** Stage 2: the A2A handoff — two exchanges build the nested act chain; the registry decides. */
export function A2aPanel() {
  const [t1, setT1] = useState(null);
  const [t2, setT2] = useState(null);
  const [specialist, setSpecialist] = useState("portfolio-specialist");
  const [result, setResult] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [fail, setFail] = useState(null);
  const loadRegistry = useCallback(async () => { const j = await a2aRegistry().catch(() => null); if (j) setRegistry(j.specialists); }, []);
  useEffect(() => { loadRegistry(); }, [loadRegistry]);
  const one = async () => { setFail(null); setT2(null); setResult(null); const j = await a2aExchangeOne({ user: "demoUser" }).catch(() => null); if (j?.token) setT1(j.token); else setFail("Exchange #1 failed."); };
  const two = async () => { setFail(null); setResult(null); const j = await a2aExchangeTwo({ generalistToken: t1, specialist }).catch(() => null); if (j?.token) setT2(j.token); else setFail(j?.detail || "Exchange #2 failed."); };
  const call = async () => {
    setFail(null);
    const r = await a2aTool({ token: t2 }).catch(() => ({ body: {} }));
    setResult(r.body.decision ? r.body : null);
    if (!r.body.decision) setFail(r.body.detail || r.body.error || "Call failed.");
  };
  const flip = async (registered) => { await a2aRegistrySet({ specialist: "rogue-specialist", registered }).catch(() => null); loadRegistry(); };
  const chain = (t) => t ? `sub=${t.sub} -> act={${t.act.sub}${t.act.act ? ` -> ${t.act.act.sub}` : ""}}` : "(not minted)";
  return (
    <section className="panel" aria-labelledby="a2a-h" data-testid="a2a-panel">
      <h2 id="a2a-h">A2A handoff (nested act chain)</h2>
      <p className="muted">Two RFC 8693 exchanges build act=&#123;specialist, act:&#123;generalist&#125;&#125; — scope narrowed per hop. The gateway routes the call only when the SPECIALIST is registered.</p>
      <label htmlFor="a2a-spec">Specialist</label>
      <input id="a2a-spec" type="text" maxLength={64} value={specialist} onChange={(e) => setSpecialist(e.target.value)} data-testid="a2a-specialist" />
      <div className="seg" role="group" aria-label="A2A steps">
        <button type="button" onClick={one} data-testid="a2a-ex1">1. Consent &amp; exchange</button>
        <button type="button" onClick={two} disabled={!t1} data-testid="a2a-ex2">2. Handoff</button>
        <button type="button" onClick={call} disabled={!t2} data-testid="a2a-call">3. Call as the specialist</button>
      </div>
      <ol className="facts" data-testid="a2a-chain">
        <li>Exchange #1: <code>{chain(t1)}</code></li>
        <li>Exchange #2: <code>{chain(t2)}</code></li>
      </ol>
      {result && <p data-testid="a2a-result" className={result.decision === "PERMIT" ? "verdict__word" : ""}>{result.decision}{result.code ? ` (${result.code})` : ""} — depth {result.chainDepth}</p>}
      {registry && (
        <div>
          <p className="muted">Registry: [ {registry.join(", ")} ]</p>
          <div className="seg" role="group" aria-label="Registry flips">
            <button type="button" data-testid="a2a-reg-add" onClick={() => flip(true)}>Register rogue-specialist</button>
            <button type="button" data-testid="a2a-reg-remove" onClick={() => flip(false)}>Revoke rogue-specialist</button>
          </div>
        </div>
      )}
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}


/** Stage 3: the attack gallery — each attack is a scripted flow whose refusal is the point. */
export function AttackGallery() {
  const [attacks, setAttacks] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [fail, setFail] = useState(null);
  useEffect(() => { getAttacks().then((j) => setAttacks(j.attacks), () => setAttacks(null)); }, []);
  const run = async (id) => {
    setFail(null); setBusy(id);
    const r = await runAttack({ attackId: id }).catch(() => ({ ok: false, body: {} }));
    setBusy(null);
    if (r.body.tried) setResult(r.body); else setFail(r.body.detail || "Could not run the attack.");
  };
  return (
    <section className="panel" aria-labelledby="atk-h" data-testid="attack-gallery">
      <h2 id="atk-h">Attack gallery <span className="muted">the refusal is the point</span></h2>
      <p className="muted">Eleven scripted attacks — stolen tokens, confused deputies, floods. Each shows what the attacker tried, what they got, and WHICH product stopped them at WHICH layer.</p>
      <div className="seg" role="group" aria-label="Attacks">
        {(attacks || []).map((a) => (
          <button key={a.id} type="button" aria-pressed={result?.attackId === a.id} disabled={busy != null} onClick={() => run(a.id)}>{a.title}</button>
        ))}
      </div>
      {result && (
        <div className="narrative-step" data-testid="attack-result">
          <h3>{result.got.status === 200 ? "Narrowed" : `Refused (${result.got.status})`}</h3>
          <p data-testid="attack-tried"><strong>Tried.</strong> {visible(result.tried)}</p>
          <p data-testid="attack-got"><strong>Got.</strong> {result.got.status} {result.got.code ? <code>{visible(result.got.code)}</code> : ""} — {visible(result.detail)}</p>
          {result.stoppedBy && <p data-testid="attack-stopped"><strong>Stopped by {visible(result.stoppedBy.product)}</strong> ({visible(result.stoppedBy.layer)}). {visible(result.stoppedBy.why)}</p>}
          <p className="lesson" data-testid="attack-lesson"><strong>The lesson.</strong> {visible(result.lesson)}</p>
        </div>
      )}
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

/** The live directory board: groups are read on EVERY decision. */
function DirectoryBoard({ onChanged }) {
  const [directory, setDirectoryState] = useState(null);
  const [user, setUser] = useState("demoUser");
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    const j = await getDirectory().catch(() => null);
    if (j) setDirectoryState(j.directory);
  }, []);
  useEffect(() => { load(); }, [load, onChanged]);
  const flip = async (add) => {
    setMsg(null);
    const current = directory?.[user] || { groups: [], tier: "Standard" };
    const has = current.groups.includes("privileged");
    const groups = add === has ? current.groups : add ? [...current.groups, "privileged"] : current.groups.filter((g) => g !== "privileged");
    const r = await setDirectory({ user, groups, tier: current.tier }).catch(() => ({ ok: false }));
    if (r.ok) { setMsg(`${user} -> [ ${groups.join(", ") || "no groups"} ]`); await load(); if (onChanged) onChanged(); }
    else setMsg("Could not flip the membership.");
  };
  return (
    <section className="panel" aria-labelledby="dir-h" data-testid="directory-board">
      <h2 id="dir-h">Live directory</h2>
      <p className="muted">Groups are read on EVERY decision. Flip the privileged group and the very next call moves — no code change, no cache, no re-login. Flips are per workspace.</p>
      <label htmlFor="dir-user">User</label>
      <input id="dir-user" type="text" maxLength={64} value={user} onChange={(e) => setUser(e.target.value)} data-testid="dir-user" />
      <div className="seg" role="group" aria-label="Directory flips">
        <button type="button" data-testid="flip-in" onClick={() => flip(true)}>Grant privileged</button>
        <button type="button" data-testid="flip-out" onClick={() => flip(false)}>Revoke privileged</button>
      </div>
      {msg && <p className="muted" role="status" data-testid="dir-msg">{msg}</p>}
      {directory && (
        <ul className="facts" data-testid="dir-groups">
          {Object.entries(directory).map(([u, e]) => <li key={u}><code>{visible(u)}</code>: [ {(e.groups || []).map((x) => visible(x)).join(", ") || "no groups"} ], tier {visible(e.tier || "Standard")}</li>)}
        </ul>
      )}
    </section>
  );
}

export default function PolicyGate({ story, resetSignal, requestedId, onSelect }) {
  const known = (v) => story.scenarios.some((s) => s.id === v);
  const [id, setId] = useState(known(requestedId) ? requestedId : story.scenarios[0].id);
  useEffect(() => { if (known(requestedId)) setId(requestedId); }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [catalog, setCatalog] = useState(null);
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const [selectedUc, setSelectedUc] = useState(null);
  const selected = catalog ? (catalog.useCases.find((u) => u.id === (selectedUc?.id ?? selectedUc)) ?? null) : null;
  const [boardTick, setBoardTick] = useState(0);
  const scenario = story.scenarios.find((s) => s.id === id) || story.scenarios[0];
  useEffect(() => { getCatalog().then(setCatalog, () => setCatalog(null)); }, []);

  const runToken = useRef(0);
  const runScenario = useCallback(async (sid) => {
    const token = ++runToken.current;
    const drop = () => token !== runToken.current;
    setFail(null);
    const sc = story.scenarios.find((s) => s.id === sid) || story.scenarios[0];
    // seed the directory the way the scenario states
    const entry = sc.flipTo ? { groups: sc.flipTo, tier: "Standard" } : null;
    if (entry) {
      await setDirectory({ user: sc.user, groups: entry.groups, tier: "Standard" }).catch(() => null);
      if (drop()) return;
    }
    const c = await consent({ user: sc.user, actor: sc.actor, aud: sc.aud }).catch(() => ({ ok: false, body: {} }));
    if (drop()) return;
    if (!c.ok) { setRun(null); setFail(c.body.detail || "Could not mint the delegated token."); return; }
    const payload = { token: c.body.token, tool: sc.tool, ucId: sc.ucId };
    if (sc.amount != null) payload.amount = sc.amount;
    const res = await authorize(payload).catch(() => ({ ok: false, status: 0, body: {} }));
    if (drop()) return;
    if (res.body.decision) { setRun(res.body); setSelectedUc({ id: sc.ucId }); } else { setRun(null); setFail(`Could not evaluate (${res.body.detail || res.body.error || res.status}).`); }
  }, [story]);

  useEffect(() => { setRun(null); }, [resetSignal]);
  useEffect(() => { runScenario(id); }, [id, resetSignal, runScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gate">
      <section className="panel" aria-labelledby="sc-h">
        <h2 id="sc-h">Live scenarios (stage 1)</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); if (onSelect) onSelect(s.id); }}>{s.title}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{scenario.lesson}</p>
      </section>
      <section className="panel" aria-labelledby="res-h">
        <h2 id="res-h">Decision</h2>
        {fail && <p className="field-error" role="alert">{fail}</p>}
        <Verdict run={run} />
        {run && <Hops hops={run.hops} traceId={run.traceId} />}
      </section>
      <ObligationPanel run={run} onResolved={(r) => setRun(r)} />
      <DirectoryBoard onChanged={() => setBoardTick((n) => n + 1)} />
      <A2aPanel />
      <AttackGallery />
      {selected && <UseCaseDetail uc={selected} onClose={() => setSelectedUc(null)} />}
      {catalog && <CatalogList catalog={catalog} onSelect={(u) => setSelectedUc(u.id)} selectedUc={selectedUc?.id ?? selectedUc} />}
      <section className="panel" aria-labelledby="scen-h">
        <h2 id="scen-h">What we know, and how well{selected ? ` — ${visible(selected.id)}` : ""}</h2>
        <p className="tag tag--warn">{story.tokenLabel}</p>
        <ul className="facts" data-testid="facts">
          {(selected ? useCaseFacts(selected) : story.facts).map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {visible(f.text)} <span className="muted">({visible(f.source)})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
