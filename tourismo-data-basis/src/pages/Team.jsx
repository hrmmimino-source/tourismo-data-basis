import { useEffect, useMemo, useState } from 'react';
import { supabase, adminUsers, niceError } from '../supabase.js';
import { useAuth } from '../auth.jsx';
import { ROLES, roleLabel } from '../labels.js';

const EMPTY = { full_name: '', email: '', short_name: '', role: 'member', can_open_no_prices: false };

export default function Team() {
  const { isAdmin, profile: me, reloadProfile } = useAuth();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);   // profile being edited, or EMPTY for new
  const [secret, setSecret] = useState(null);     // { name, email, password } to show once

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('is_active', { ascending: false }).order('full_name');
    if (error) setError(niceError(error)); else setPeople(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => people.filter((p) => showInactive || p.is_active), [people, showInactive]);
  const inactiveCount = people.filter((p) => !p.is_active).length;

  async function resetPassword(p) {
    if (!confirm(`Create a new temporary password for ${p.full_name || p.email}? Their current password will stop working.`)) return;
    try {
      const r = await adminUsers({ action: 'reset_password', user_id: p.id });
      setSecret({ name: p.full_name || p.email, email: p.email, password: r.temp_password, reset: true });
    } catch (e) { alert(niceError(e)); }
  }

  async function setActive(p, active) {
    const msg = active
      ? `Re-activate ${p.full_name || p.email}? They will be able to sign in again.`
      : `Deactivate ${p.full_name || p.email}? They will not be able to sign in, and their open tasks will become unassigned. Their history is kept.`;
    if (!confirm(msg)) return;
    try {
      await adminUsers({ action: 'set_active', user_id: p.id, active });
      await load();
    } catch (e) { alert(niceError(e)); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Everyone who can sign in to the platform.</p>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>＋ Add team member</button>}
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card table-card">
        <div className="table-tools">
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show former team members ({inactiveCount})
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Name in old Excel</th><th>Email</th><th>Role</th>
                <th title='Can open dates closed because of "no prices"'>Can open “!!!!!”</th><th>Status</th>
                {isAdmin && <th className="right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {!loading && shown.map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'inactive'}>
                  <td><strong>{p.full_name || '—'}</strong>{p.id === me.id && <span className="tag">you</span>}</td>
                  <td>{p.short_name || '—'}</td>
                  <td>{p.email}</td>
                  <td><span className={`role role-${p.role}`}>{roleLabel(p.role)}</span></td>
                  <td>{p.can_open_no_prices || ['manager', 'admin'].includes(p.role) ? 'Yes' : 'No'}</td>
                  <td>{p.is_active ? <span className="status ok">Active</span> : <span className="status off">Former member</span>}</td>
                  {isAdmin && (
                    <td className="right"><div className="row-actions">
                      <button className="btn small" onClick={() => setEditing(p)}>Edit</button>
                      {p.is_active && <button className="btn small" onClick={() => resetPassword(p)}>Reset password</button>}
                      {p.id !== me.id && (p.is_active
                        ? <button className="btn small danger" onClick={() => setActive(p, false)}>Deactivate</button>
                        : <button className="btn small" onClick={() => setActive(p, true)}>Re-activate</button>)}
                    </div></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <MemberDialog
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={async (result) => {
            setEditing(null);
            if (result?.temp_password) setSecret(result);
            await load();
            await reloadProfile();
          }}
        />
      )}
      {secret && <PasswordNotice secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function MemberDialog({ person, onClose, onSaved }) {
  const isNew = !person.id;
  const [form, setForm] = useState({ ...EMPTY, ...person });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (isNew) {
        if (!form.full_name.trim()) throw new Error('Please enter the full name.');
        const r = await adminUsers({
          action: 'create',
          email: form.email.trim().toLowerCase(),
          full_name: form.full_name.trim(),
          short_name: form.short_name.trim() || null,
          role: form.role,
          can_open_no_prices: form.can_open_no_prices,
        });
        await onSaved({ name: form.full_name, email: form.email.trim().toLowerCase(), password: r.temp_password, temp_password: r.temp_password });
      } else {
        const { error } = await supabase.from('profiles').update({
          full_name: form.full_name.trim(),
          short_name: form.short_name?.trim() || null,
          role: form.role,
          can_open_no_prices: form.can_open_no_prices,
        }).eq('id', person.id);
        if (error) throw error;
        await onSaved();
      }
    } catch (err) {
      setError(niceError(err));
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{isNew ? 'Add team member' : `Edit ${person.full_name || person.email}`}</h2>

        <label>Full name
          <input value={form.full_name} onChange={set('full_name')} required autoFocus placeholder="e.g. Gvantsa Beridze" />
        </label>
        <label>Work email (used to sign in)
          <input type="email" value={form.email} onChange={set('email')} required disabled={!isNew} placeholder="name@tourismo.ge" />
        </label>
        <label>Name in the old Excel <span className="muted">(optional)</span>
          <input value={form.short_name || ''} onChange={set('short_name')} placeholder="e.g. Gvantsa" />
        </label>
        <label>Role
          <select value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.can_open_no_prices || ['manager', 'admin'].includes(form.role)}
            disabled={['manager', 'admin'].includes(form.role)} onChange={set('can_open_no_prices')} />
          Can open dates closed because of “no prices” (!!!!!)
          {['manager', 'admin'].includes(form.role) && <span className="muted"> — always allowed for managers and admins</span>}
        </label>

        {isNew && <p className="hint">A temporary password will be created. You will see it once, and the person chooses their own password at first sign-in.</p>}
        {error && <div className="alert error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create account' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function PasswordNotice({ secret, onClose }) {
  const site = window.location.href.split('#')[0];
  const text = `Hi ${secret.name.split(' ')[0]},\n\n${secret.reset ? 'Your password for the Data Basis platform was reset.' : 'Your account for the Tourismo Data Basis platform is ready.'}\n\nLink: ${site}\nEmail: ${secret.email}\nTemporary password: ${secret.password}\n\nYou will be asked to choose your own password when you sign in.`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{secret.reset ? 'New temporary password' : 'Account created'}</h2>
        <p>Send this to <strong>{secret.name}</strong> (for example by Teams, WhatsApp or in person). <strong>It is shown only once.</strong></p>
        <pre className="secret">{text}</pre>
        <div className="modal-actions">
          <button className="btn" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>
            {copied ? '✓ Copied' : 'Copy message'}
          </button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
