import "./TokenCardsPanel.css";

// Lab-own token cards (P3): the plan's slim rule keeps only the token-card view, so this is
// written for the lab's `tokens` payload ({ id, title, role, mock, claims, diff }) instead of
// porting AI-DEMO2's events-shaped TokenCards. Claim tooltips come from the vendored
// CLAIM_GLOSSARY (components/tokenchain/claimGlossary.js); the pretty JSON viewer is the vendored
// JsonHighlight. Tokens are shown RAW and labelled MOCK: the mint is the lab's own, there are
// no real secrets anywhere. The act diff — act added, aud rebound — is lab-own per the plan.
import { CLAIM_GLOSSARY } from "../components/tokenchain/claimGlossary.js";
import JsonHighlight from "../components/tokenchain/JsonHighlight.jsx";

const visible = (v) => (v == null || v === "" ? "—" : String(v));

function Claims({ claims }) {
  const entries = Object.entries(claims || {});
  if (!entries.length) return null;
  return (
    <dl className="tcp__claims">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt title={CLAIM_GLOSSARY[k] || undefined}>{k}</dt>
          <dd>{typeof v === "object" ? JSON.stringify(v) : visible(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The lab-own act diff: what the RFC 8693 exchange changed vs the parent token. */
function ActDiff({ diff }) {
  if (!diff) return null;
  const bits = [
    diff.added?.length ? `added: ${diff.added.join(", ")}` : null,
    diff.rebound?.length ? `rebound: ${diff.rebound.join(", ")}` : null,
    diff.narrowed?.length ? `narrowed: ${diff.narrowed.join(", ")}` : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return (
    <p className="tcp__diff" data-testid="token-act-diff">
      <b>What the exchange changed:</b> {bits.join(" · ")} <span className="muted">(RFC 8693 §4: sub stays the human; act names the agent)</span>
    </p>
  );
}

export default function TokenCardsPanel({ tokens }) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return <p className="muted" data-testid="tokens-empty">The tokens of the run show here — raw claims, labelled MOCK.</p>;
  return (
    <div className="tcp" role="group" aria-label="Tokens in this run" data-testid="token-cards">
      {list.map((t) => (
        <article key={t.id} className={`tcp__card tcp__card--${t.id}`}>
          <h4>{t.title} <span className="tcp__mock" title="The lab minted this token itself; nothing here is a real credential">MOCK</span></h4>
          <p className="muted">{t.role}</p>
          <ActDiff diff={t.diff} />
          <Claims claims={t.claims} />
          <details className="tcp__raw">
            <summary>Raw claims (JSON)</summary>
            <pre className="jh-dark"><JsonHighlight value={t.claims} /></pre>
          </details>
        </article>
      ))}
    </div>
  );
}
