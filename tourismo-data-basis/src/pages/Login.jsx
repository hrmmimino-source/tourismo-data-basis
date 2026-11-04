import { useState } from 'react';
import { supabase, niceError } from '../supabase.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(niceError(error));
    setBusy(false);
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <img src="./logo.png" alt="Tourismo" className="auth-logo" />
        <h1>Data Basis</h1>
        <p className="muted">Stop sales &amp; openings platform</p>

        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {error && <div className="alert error">{error}</div>}

        <button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <button type="button" className="link-btn center" onClick={() => setShowHelp(!showHelp)}>Forgot your password?</button>
        {showHelp && (
          <div className="alert info">
            Ask the platform admin to reset it. You will get a temporary password and choose a new one when you sign in.
          </div>
        )}
      </form>
    </div>
  );
}
