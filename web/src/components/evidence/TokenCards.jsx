// P3 (lab-own): the run's tokens as raw, MOCK-labelled cards. No decoding endpoint —
// the server already sends plain claim objects on the run (tokens: TokenCard[]). The
// delegated token carries a diff view: what was added (act), rebound (aud) and
// narrowed (scope) versus the parent user token. Every card is labelled MOCK.
export function TokenDiff({ diff }) {
  if (!diff) return null;
  return (
    <div className="tc-diff" data-testid="token-diff">
      <b>What the exchange changed</b>
      <ul>
        {diff.added.length > 0 && <li data-testid="token-diff-added">added: <code>{diff.added.join(", ")}</code> — the delegation (act) and the mint claims</li>}
        {diff.rebound.length > 0 && <li data-testid="token-diff-rebound">rebound: <code>{diff.rebound.join(", ")}</code> — an audience is a destination</li>}
        {diff.narrowed.length > 0 && <li data-testid="token-diff-narrowed">narrowed: <code>{diff.narrowed.join(", ")}</code> — least privilege, cut to what this call needs</li>}
      </ul>
    </div>
  );
}

export default function TokenCards({ tokens = [] }) {
  if (!tokens.length) return <p className="muted" data-testid="token-cards-empty">The run's mock tokens land here: the user token, the agent token and the delegated token.</p>;
  return (
    <div className="tc-wrap" data-testid="token-cards">
      {tokens.map((t) => (
        <div key={t.id} className="panel tc-card" data-testid={`token-card-${t.id}`}>
          <h3>{t.title} <span className="tag tag--warn" title="A mock value produced by this lab's engine">MOCK</span></h3>
          <p className="muted">{t.role}</p>
          <pre className="json" data-testid={`token-claims-${t.id}`}>{JSON.stringify(t.claims, null, 2)}</pre>
          {t.diff && <TokenDiff diff={t.diff} />}
        </div>
      ))}
    </div>
  );
}
