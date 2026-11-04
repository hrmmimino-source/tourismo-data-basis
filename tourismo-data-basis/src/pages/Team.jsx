import { useEffect, useState } from 'react';
import { supabase, adminUsers, niceError } from '../supabase.js';
import { useAuth } from '../auth.jsx';
import { ROLES, roleLabel } from '../labels.js';
import { UnlinkedExcelNames } from './Hotels.jsx';

const EMPTY = { full_name: '', email: '', short_name: '', role: 'member', can_open_no_prices: false };

export default function Team() {
  const { isAdmin, isManager, profile: me, reloadProfile } = useAuth();
  const [people, setPeople] = useState([]);
  const [temps, setTemps] = useState({});         // user_id -> temporary password (admins/managers only)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // profile being edited, or EMPTY for new
  const [secret, setSecret] = useState(null);     // { name, email, password } message to copy

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('is_active', { ascending: false }).order('full_name');
    if (error) setError(niceError(error)); else setPeople(data);
    if (isManager) {
      const { data: t } = await supabase.from('temp_passwords').select('user_id, password, created_at');
      setTemps(Object.fromEntries((t || []).map((x) => [x.user_id, x])));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [isManager]);

  const activeCount = people.filter((p) => p.is_active).length;
  const inactiveCount = people.length - activeCount;

  async function resetPassword(p) {
    if (!confirm(`Create a new temporary password for ${p.full_name || p.email}? Their current password will stop working.`)) return;
    try {
      const r = await adminUsers({ action: 'reset_password', user_id: p.id });
      setSecret({ name: p.full_name || p.email, email: p.email, password: r.temp_password, reset: true });
      await load();
    } catch (e) { alert(niceError(e)); }
  }

  async function setActive(p, active) {
    const msg = active
      ? `Re-activate ${p.full_name || p.email}? They will be able to sign in again.`
      : `Deactivate ${p.full_name || p.email}? They will not be able to sign in, and their open tasks will become unassigned. They stay in this list as a former member, and their history is kept.`;
    if (!confirm(msg)) return;
    try {
      await adminUsers({ action: 'set_active', user_id: p.id, active });
      await load();
    } catch (e) { alert(niceError(e)); }
  }

  const cols = 7 + (isManager ? 1 : 0) + (isAdmin ? 1 : 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">{activeCount} active · {inactiveCount} former {inactiveCount === 1 ? 'member' : 'members'}</p>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>＋ Add team member</button>}
      </div>

      {error && <div className="alert error">{error}</div>}
      {isAdmin && <UnlinkedExcelNames key={people.length} />}

      <div className="card table-card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Name in old Excel</th><th>Email</th><th>Role</th>
                <th title='Can open dates closed because of "no prices"'>Can open “!!!!!”</th><th>Status</th>
                {isManager && <th title="Shown until the person sets their own password">Temporary password</th>}
                {isAdmin && <th className="right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={cols} className="muted">Loading…</td></tr>}
              {!loading && people.map((p) => {
                const temp = temps[p.id];
                return (
                  <tr key={p.id} className={p.is_active ? '' : 'inactive'}>
                    <td><strong>{p.full_name || '—'}</strong>{p.id === me.id && <span className="tag">you</span>}</td>
                    <td>{p.short_name || '—'}</td>
                    <td>{p.email}</td>
                    <td><span className={`role role-${p.role}`}>{roleLabel(p.role)}</span></td>
                    <td>{p.can_open_no_prices || ['manager', 'admin'].includes(p.role) ? 'Yes' : 'No'}</td>
                    <td>
                      {!p.is_active
                        ? <span className="status off">Former member</span>
                        : temp
                          ? <span className="status wait">Waiting for first sign-in</span>
                          : <span className="status ok">Active</span>}
                    </td>
                    {isManager && (
                      <td>{temp && p.is_active ? <TempPassword value={temp.password} /> : <span className="muted">—</span>}</td>
                    )}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {isManager && (
        <p className="hint">Temporary passwords are visible only to managers and admins, and disappear automatically as soon as the person sets their own password.</p>
      )}

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

        {isNew && <p className="hint">A temporary password will be created. It stays visible to managers and admins in the Team list until the person chooses their own password at first sign-in.</p>}
        {error && <div className="alert error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create account' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function TempPassword({ value }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <span className="temp-pw">
      <code>{shown ? value : '••••••••••'}</code>
      <button className="btn small" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>
      <button className="btn small" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? '✓' : 'Copy'}
      </button>
    </span>
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
        <p>Send this to <strong>{secret.name}</strong> (for example by Teams, WhatsApp or in person). Until they set their own password, managers and admins can also see it in the Team list.</p>
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
