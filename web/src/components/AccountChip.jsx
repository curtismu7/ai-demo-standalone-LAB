// P10: the account chip — Real SIGN-IN only (login; data stays mock). Shows "Sign in" when the Real sign-in is
// configured and no one is signed in; the signed-in user and their REAL-labelled token once they are; "Sign out"
// clears the server-side session. When the sign-in is not configured the chip stays hidden entirely (the Real
// mode toggle already explains rule 19).
import { useCallback, useEffect, useState } from "react";
import { getSignin, postSignout } from "../api";
import SignInDialog from "./SignInDialog.jsx";

export default function AccountChip() {
  const [info, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    try { setState(await getSignin()); } catch { setState(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!info || !info.available) return null; // not configured: hidden (rule 19 lives in the mode toggle)
  const signedIn = Boolean(info.signedIn);

  const signOut = async () => {
    await postSignout().catch(() => {});
    setTokens([]); setShowToken(false);
    refresh();
  };

  return (
    <div className="account-chip" data-testid="account-chip">
      {signedIn ? (
        <>
          <span data-testid="account-user">{info.user?.name ?? info.user?.sub}</span>
          <button type="button" className="mini" onClick={() => setShowToken((v) => !v)} data-testid="toggle-token">
            {showToken ? "Hide token" : "Show REAL token"}
          </button>
          {showToken && tokens.map((t) => (
            <pre key={t.label} className="token-raw" data-testid="real-token" aria-label="REAL access token">
              {"REAL\n"}
              {t.raw}
            </pre>
          ))}
          <button type="button" className="mini" onClick={signOut} data-testid="signout">Sign out</button>
        </>
      ) : (
        <button type="button" className="mini" onClick={() => setOpen(true)} data-testid="open-signin">Sign in</button>
      )}
      <SignInDialog
        isOpen={open}
        username={info.username}
        provider={info.provider}
        onClose={() => setOpen(false)}
        onSignedIn={(body) => { setOpen(false); setTokens(body.tokens ?? []); refresh(); }}
      />
    </div>
  );
}
