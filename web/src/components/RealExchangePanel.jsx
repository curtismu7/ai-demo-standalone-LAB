import { useEffect, useState } from "react";
import { realExchange } from "../api";
import "./RealExchangePanel.css";

const JWT_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const ACCESS_TYPE = "urn:ietf:params:oauth:token-type:access_token";

// The pretty-printer for the exchange result: claims as rows, the act chain highlighted, every token hashed.
function IssuedView({ issued }) {
  const claims = issued.claims || {};
  return (
    <div className="rx-result" data-testid="rx-issued">
      <p className="rx-line"><b>HTTP 200</b> — a token was issued. <span className="mono muted">token {issued.tokenHash}</span> {issued.expiresIn ? <span className="mono muted">· expires_in {issued.expiresIn}s</span> : null}</p>
      <table className="rx-claims" data-testid="rx-claims">
        <thead><tr><th>Claim</th><th>Value</th></tr></thead>
        <tbody>
          {Object.entries(claims).map(([k, v]) => (
            <tr key={k} className={k === "act" ? "rx-act" : undefined}>
              <td><code>{k}</code></td>
              <td><code>{typeof v === "string" ? v : JSON.stringify(v)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      {claims.act ? (
        <p className="rx-note" data-testid="rx-act">The <code>act</code> chain names the actor from the third-party JWT's <code>sub</code> — mapped in by the trusted issuer's attribute mapping. Every hop traces back to it.</p>
      ) : (
        <p className="rx-note" data-testid="rx-act">No <code>act</code> claim in the issued token. Check the trusted issuer's attribute mapping (e.g. <code>act.sub</code> from the actor <code>sub</code>).</p>
      )}
    </div>
  );
}

// Real PingOne third-party token exchange (RFC 8693, actor_token_type:jwt). Owner-configured via the
// AIDEMOLAB_REAL_* env; the shell's Mock | Real toggle switches to Real only when it is. The client secret
// never leaves the server env; tokens pasted here are sent once and never stored.
export default function RealExchangePanel({ realAvailable }) {
  const [subjectToken, setSubjectToken] = useState("");
  const [actorToken, setActorToken] = useState("");
  const [subjectType, setSubjectType] = useState(ACCESS_TYPE);
  const [scope, setScope] = useState("openid");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, status, ... } | { error }

  useEffect(() => { setResult(null); }, [realAvailable]);

  const ready = realAvailable && subjectToken.trim() && actorToken.trim() && !busy;

  const send = async () => {
    setBusy(true); setResult(null);
    const r = await realExchange({
      subjectToken, actorToken, subjectType, scope, audience: audience || undefined,
    }).catch((e) => ({ ok: false, status: 0, body: { error: "client_error", detail: e.message } }));
    setBusy(false);
    setResult(r);
  };

  if (!realAvailable) {
    return (
      <section className="panel rx" data-testid="real-exchange-panel">
        <h2>Real PingOne exchange</h2>
        <p className="muted">Real mode is not configured, so this panel is inactive. The owner sets <code>AIDEMOLAB_REAL_URL</code>, <code>AIDEMOLAB_REAL_CLIENT_ID</code> and <code>AIDEMOLAB_REAL_CLIENT_SECRET</code> in the lab's <code>.env</code> (see <code>.env.example</code>), restarts the lab, and flips the shell's Mock | Real toggle. The tenant also needs: a trusted issuer matching the third-party JWT's <code>iss</code> (with its JWKS URL), that issuer assigned to the exchanging app, and the token-exchange grant on it.</p>
      </section>
    );
  }

  return (
    <section className="panel rx" data-testid="real-exchange-panel">
      <h2>Real PingOne exchange <span className="tag ok">REAL</span></h2>
      <p className="muted">Sends one RFC 8693 token exchange to your PingOne: a PingOne token as the subject, a third-party signed JWT as the actor (<code>token_type:jwt</code>). The request goes from this lab's server; the client secret never leaves the env; tokens are shown hashed after the run. Refusal texts below are PingOne's own.</p>
      <div className="rx-fields">
        <label>Subject token (PingOne access token)
          <textarea rows={3} value={subjectToken} onChange={(e) => setSubjectToken(e.target.value)} data-testid="rx-subject" spellCheck={false} />
        </label>
        <label>subject_token_type
          <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)} data-testid="rx-subject-type">
            <option value={ACCESS_TYPE}>access_token (PingOne)</option>
            <option value={JWT_TYPE}>jwt (third-party JWT)</option>
          </select>
        </label>
        <label>Actor token (the third-party signed JWT)
          <textarea rows={3} value={actorToken} onChange={(e) => setActorToken(e.target.value)} data-testid="rx-actor" spellCheck={false} />
        </label>
        <div className="rx-row">
          <label>Scope
            <input type="text" value={scope} onChange={(e) => setScope(e.target.value)} data-testid="rx-scope" />
          </label>
          <label>Audience (optional)
            <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} data-testid="rx-audience" />
          </label>
        </div>
      </div>
      <div className="rx-actions">
        <button type="button" className="primary" disabled={!ready} onClick={send} data-testid="rx-send">Send real exchange</button>
        <span className="muted" data-testid="rx-hint">{ready ? "One request to your PingOne." : "Paste both tokens to enable."}</span>
      </div>
      {result && (
        <div className="rx-outcome" data-testid="rx-outcome" role="status">
          {result.ok ? (
            <IssuedView issued={result.body.issued} />
          ) : (
            <div className="rx-error" data-testid="rx-error">
              <p className="rx-line"><b>HTTP {result.status}</b> — <code>{result.body?.error || "error"}</code></p>
              <p className="rx-detail">{result.body?.detail || result.body?.error_description || "The exchange was refused."}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
