// The standard Sign in modal for Real (owner rules: the password step is this modal, never an inline form; login
// is pi.flow only, never a redirect). The lab's server drives the IdP's pi.flow: authorize (response_mode=pi.flow,
// PKCE S256), the flows API username/password step (PingOne), then the code for tokens. The username comes from the
// server (AIDEMOLAB_SIGNIN_USERNAME) and is read-only here. The password lives in this component's state only while
// the dialog is open: it is cleared the moment it is sent, on close and on unmount, and the page never shows it back.
// Pattern from customer-agent-LAB's SignInDialog (owner-verified); this lab's copy is login-only.
import { useEffect, useRef, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog.jsx";
import { postSignin } from "../api";
import { visible } from "../safeText";

export default function SignInDialog({ isOpen, username, provider, onClose, onSignedIn }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pwRef = useRef(null);
  useEffect(() => { if (!isOpen) { setPassword(""); setError(null); setBusy(false); } }, [isOpen]);
  useEffect(() => () => setPassword(""), []);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    const sent = password;
    setPassword(""); // cleared at once: nothing keeps the password after it is sent
    setBusy(true); setError(null);
    const res = await postSignin(sent).catch(() => ({ ok: false, status: 0, json: async () => ({ message: "The server did not answer." }) }));
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body?.signedIn) { onSignedIn?.(body); return; }
    setError(`${body?.message || body?.detail || "Sign-in failed."}${res.status ? ` (HTTP ${res.status})` : ""}`);
    pwRef.current?.focus();
  };
  return (
    <FloatingDialog isOpen={isOpen} onClose={() => { setPassword(""); onClose?.(); }} title="Sign in" ariaLabel="Sign in" defaultWidth={420} defaultHeight={430} testId="signin-dialog">
      <form className="stack" onSubmit={submit} data-testid="signin-form">
        <p className="muted" data-testid="signin-method">
          Real sign-in with {provider === "pingfederate" ? "PingFederate" : "PingOne"}, <strong>pi.flow</strong>: this lab's
          server sends your password once to the IdP's flows API. No redirect, and the password is never stored, logged or shown.
          Sign-in only — the data behind the dashboard stays mock.
        </p>
        <label className="field">
          <span className="field-label">Username</span>
          <input type="text" name="username" value={username || ""} readOnly autoComplete="username" data-testid="signin-username" aria-describedby="signin-username-note" />
        </label>
        <p className="muted" id="signin-username-note">Filled in from this lab's settings (AIDEMOLAB_SIGNIN_USERNAME).</p>
        <label className="field">
          <span className="field-label">Password</span>
          <input ref={pwRef} type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value.slice(0, 256))} autoComplete="current-password" required maxLength={256} data-testid="signin-password" autoFocus />
        </label>
        {error && <p className="field-error" role="alert" data-testid="signin-error">{visible(error)}</p>}
        <div className="seg">
          <button type="submit" className="primary" disabled={busy || !password} data-testid="signin-submit">{busy ? "Signing in..." : "Sign in"}</button>
          <button type="button" onClick={() => { setPassword(""); onClose?.(); }} data-testid="signin-cancel">Cancel</button>
        </div>
      </form>
    </FloatingDialog>
  );
}
