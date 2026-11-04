import { useState } from 'react';
import { supabase, niceError } from '../supabase.js';
import { useAuth } from '../auth.jsx';

export function PasswordForm({ onDone, submitLabel = 'Save new password' }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(false);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords are not the same.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    setBusy(false);
    if (error) return setError(niceError(error));
    setPw(''); setPw2(''); setOk(true);
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>New password
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      <label>Repeat new password
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </label>
      <p className="hint">At least 8 characters. Do not reuse your email password.</p>
      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert success">Password changed.</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

export default function ChangePassword() {
  const { signOut } = useAuth();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src="./logo.png" alt="Tourismo" className="auth-logo" />
        <h1>Choose your password</h1>
        <p className="muted">You signed in with a temporary password. Please choose your own password to continue.</p>
        <PasswordForm submitLabel="Save and continue" onDone={() => supabase.auth.refreshSession()} />
        <button className="link-btn center" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
