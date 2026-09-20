import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Icon } from "../components/Icon.js";

export function LoginPage() {
  const { login, bootstrap } = useAuth();
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  // Private hub: offer first-time setup only while no admin exists. The server enforces this regardless.
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    api
      .get<{ setupOpen: boolean }>("/api/auth/setup-open")
      .then((res) => setSetupOpen(res.setupOpen))
      .catch(() => setSetupOpen(false));
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") await login(email, password);
      else await bootstrap(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>TCW A/B Tester</h1>
        {setupOpen && (
          <div className="tab-switch" role="group" aria-label="Sign in or first-time setup">
            <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")}>Log in</button>
            <button type="button" aria-pressed={mode === "bootstrap"} onClick={() => setMode("bootstrap")}>First-time setup</button>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" />
          <span id="password-hint" className="hint">{mode === "bootstrap" ? "At least 10 characters. This creates the first admin account." : "At least 10 characters."}</span>
        </div>

        {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}

        <button type="submit" className="btn" disabled={submitting} style={{ width: "100%" }}>
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
