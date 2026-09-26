import { FormEvent, useState } from "react";
import { KeyRound, LockKeyhole, UserRound } from "lucide-react";

type AuthGateProps = {
  mode: "setup" | "unlock";
  username?: string;
  error?: string;
  onSetup: (username: string, password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<void>;
};

export function AuthGate({ mode, username, error, onSetup, onUnlock }: AuthGateProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (mode === "setup") {
      if (!name.trim()) return setFormError("Enter a username.");
      if (password.length < 8) return setFormError("Use at least 8 characters for the password.");
      if (password !== confirmation) return setFormError("Passwords do not match.");
    } else if (!password) {
      return setFormError("Enter your password.");
    }

    setBusy(true);
    try {
      if (mode === "setup") await onSetup(name.trim(), password);
      else await onUnlock(password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-gate">
      <section className="auth-gate-panel" aria-labelledby="auth-title">
        <div className="auth-gate-mark" aria-hidden>
          {mode === "setup" ? <KeyRound size={22} /> : <LockKeyhole size={22} />}
        </div>
        <p className="auth-gate-kicker">AEGIS BROWSER</p>
        <h1 id="auth-title">{mode === "setup" ? "Create your browser profile" : "Unlock Aegis"}</h1>
        <p className="auth-gate-copy">
          {mode === "setup" ? "Your password protects access to this browser and its local data." : `Welcome back, ${username || "user"}.`}
        </p>
        <form onSubmit={submit} className="auth-gate-form">
          {mode === "setup" && (
            <label className="auth-gate-field">
              <span>Username</span>
              <div className="auth-gate-input-wrap"><UserRound size={16} /><input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" /></div>
            </label>
          )}
          <label className="auth-gate-field">
            <span>Password</span>
            <div className="auth-gate-input-wrap"><LockKeyhole size={16} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={mode === "unlock"} autoComplete={mode === "setup" ? "new-password" : "current-password"} /></div>
          </label>
          {mode === "setup" && (
            <label className="auth-gate-field">
              <span>Confirm password</span>
              <div className="auth-gate-input-wrap"><LockKeyhole size={16} /><input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" /></div>
            </label>
          )}
          {(formError || error) && <p className="auth-gate-error">{formError || error}</p>}
          <button className="auth-gate-submit" type="submit" disabled={busy}>
            {busy ? "Checking..." : mode === "setup" ? "Create profile" : "Unlock browser"}
          </button>
        </form>
      </section>
    </main>
  );
}
