import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, niceError } from '../supabase.js';
import { useAuth } from '../auth.jsx';

// ---------------------------------------------------------------- shared helpers
export const STATUSES = [
  { value: 'active', label: 'Active', hint: 'Sold in this system — changes must be made here' },
  { value: 'inactive', label: 'Inactive', hint: 'In this system, but closed now' },
  { value: 'not_active', label: 'Not active', hint: 'Not in our account in this system' },
  { value: 'na', label: 'N/A', hint: 'Not applicable' },
];
const statusLabel = (s) => STATUSES.find((x) => x.value === s)?.label ?? s;

export const RULE_TYPES = [
  { value: 'note', label: 'Note' },
  { value: 'b2b_only', label: 'B2B only' },
  { value: 'close_threshold', label: 'Close threshold (rooms left)' },
  { value: 'price_leak_risk', label: 'Price leak risk' },
  { value: 'active_only_in', label: 'Active only in listed systems' },
];
const ruleLabel = (t) => RULE_TYPES.find((x) => x.value === t)?.label ?? t;

// Supabase returns max 1000 rows per request — read in pages
export async function fetchAll(table, select = '*', build = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function personText(cell) {
  if (cell.responsible_id) return cell.responsible_short || cell.responsible_name || '?';
  return cell.responsible_excel_name || '';
}

// ================================================================= HOTELS PAGE (list + matrix)
export default function Hotels() {
  const { isManager, profile: me } = useAuth();
  const navigate = useNavigate();
  const [hotels, setHotels] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [cells, setCells] = useState([]);
  const [rules, setRules] = useState([]);
  const [systems, setSystems] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('hotels.view') || 'list'; } catch { return 'list'; } });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [person, setPerson] = useState('');
  const [system, setSystem] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { try { localStorage.setItem('hotels.view', view); } catch { /* ignore */ } }, [view]);

  useEffect(() => {
    (async () => {
      try {
        const [h, r, c, ru, s, p] = await Promise.all([
          fetchAll('hotels', '*', (x) => x.order('name')),
          fetchAll('room_types', 'id, hotel_id, is_active'),
          fetchAll('v_matrix', 'hotel_id, system_id, status, responsible_id, responsible_excel_name, responsible_name, responsible_short, responsible_active'),
          fetchAll('hotel_rules', 'id, hotel_id, is_active, rule_type'),
          fetchAll('systems', '*', (x) => x.order('sort_order')),
          fetchAll('profiles', 'id, full_name, short_name, is_active', (x) => x.order('full_name')),
        ]);
        setHotels(h); setRooms(r); setCells(c); setRules(ru); setSystems(s); setPeople(p);
      } catch (e) { setError(niceError(e)); }
      setLoading(false);
    })();
  }, []);

  const byHotel = useMemo(() => {
    const m = {};
    for (const c of cells) (m[c.hotel_id] ||= {})[c.system_id] = c;
    return m;
  }, [cells]);
  const roomCount = useMemo(() => countBy(rooms.filter((r) => r.is_active), 'hotel_id'), [rooms]);
  const ruleCount = useMemo(() => countBy(rules.filter((r) => r.is_active && r.rule_type !== 'note'), 'hotel_id'), [rules]);
  const cities = useMemo(() => [...new Set(hotels.map((h) => h.city).filter(Boolean))].sort(), [hotels]);
  const personOptions = useMemo(() => {
    const names = new Map();
    for (const c of cells) {
      if (c.status !== 'active') continue;
      const key = c.responsible_id || `excel:${c.responsible_excel_name}`;
      if (!c.responsible_id && !c.responsible_excel_name) continue;
      names.set(key, c.responsible_id ? (c.responsible_name || c.responsible_short) : `${c.responsible_excel_name} (no account yet)`);
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cells]);

  const matchesPerson = (cell) => {
    if (!person) return true;
    if (person === 'me') return cell.responsible_id === me.id;
    if (person.startsWith('excel:')) return !cell.responsible_id && cell.responsible_excel_name === person.slice(6);
    return cell.responsible_id === person;
  };

  const shown = useMemo(() => hotels.filter((h) => {
    if (!showInactive && !h.is_active) return false;
    if (city && h.city !== city) return false;
    if (q && !(`${h.name} ${h.code || ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
    const row = byHotel[h.id] || {};
    if (system && row[system]?.status !== 'active') return false;
    if (person && !Object.values(row).some((c) => c.status === 'active' && (!system || c.system_id === Number(system)) && matchesPerson(c))) return false;
    return true;
  }), [hotels, q, city, person, system, showInactive, byHotel]);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Hotels &amp; systems</h1>
          <p className="muted">{hotels.filter((h) => h.is_active).length} hotels · who handles which hotel in which system</p>
        </div>
        <div className="head-actions">
          <div className="seg">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')}>Matrix</button>
          </div>
          {isManager && <button className="btn primary" onClick={() => setAdding(true)}>＋ Add hotel</button>}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="filters card">
        <input placeholder="Search hotel…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>
          {cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={system} onChange={(e) => setSystem(e.target.value)}>
          <option value="">All systems</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Anyone responsible</option>
          <option value="me">Me</option>
          {personOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive hotels</label>
        <span className="muted count">{shown.length} shown</span>
      </div>

      {loading ? <div className="card muted">Loading…</div> : view === 'list' ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table clickable">
              <thead><tr><th>Code</th><th>Hotel</th><th>City</th><th>Room types</th><th>Active in</th><th>Rules</th><th>Flags</th></tr></thead>
              <tbody>
                {shown.map((h) => {
                  const row = byHotel[h.id] || {};
                  const act = Object.values(row).filter((c) => c.status === 'active').length;
                  return (
                    <tr key={h.id} onClick={() => navigate(`/hotels/${h.id}`)} className={h.is_active ? '' : 'inactive'}>
                      <td className="muted">{h.code}</td>
                      <td><strong>{h.name}</strong></td>
                      <td>{h.city || <span className="muted">—</span>}</td>
                      <td>{roomCount[h.id] || <span className="muted">whole hotel</span>}</td>
                      <td>{act} {act === 1 ? 'system' : 'systems'}</td>
                      <td>{ruleCount[h.id] ? <span className="pill warn">{ruleCount[h.id]}</span> : <span className="muted">—</span>}</td>
                      <td>
                        {h.no_prices_lock && <span className="pill lock">!!!!! no prices</span>}
                        {!h.is_active && <span className="pill">inactive</span>}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={7} className="muted">No hotels match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card table-card">
          <div className="legend">
            <span><i className="sw st-active" /> Active (name = responsible)</span>
            <span><i className="sw st-inactive" /> Inactive (closed now)</span>
            <span><i className="sw st-not_active" /> Not active</span>
            <span><i className="sw st-na" /> N/A</span>
            <span><em>Italic</em> = name from the old Excel, no account yet</span>
          </div>
          <div className="table-wrap matrix-wrap">
            <table className="matrix">
              <thead><tr><th className="sticky">Hotel</th>{systems.map((s) => <th key={s.id}><span>{s.name}</span></th>)}</tr></thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.id}>
                    <td className="sticky"><Link to={`/hotels/${h.id}`}>{h.name}</Link></td>
                    {systems.map((s) => {
                      const c = byHotel[h.id]?.[s.id] || { status: 'na' };
                      const dim = person && !(c.status === 'active' && matchesPerson(c));
                      return (
                        <td key={s.id} className={`st-${c.status} ${dim ? 'dim' : ''}`} title={`${s.name}: ${statusLabel(c.status)}`}>
                          {c.status === 'active' && (c.responsible_id ? personText(c) : <em>{personText(c) || '?'}</em>)}
                          {c.status === 'inactive' && 'closed'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && <AddHotel onClose={() => setAdding(false)} onCreated={(id) => navigate(`/hotels/${id}`)} />}
    </div>
  );
}

function countBy(arr, key) {
  const m = {};
  for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
}

function AddHotel({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', city: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { data, error } = await supabase.from('hotels')
      .insert({ name: form.name.trim(), city: form.city.trim() || null, code: form.code.trim() || null })
      .select('id').single();
    setBusy(false);
    if (error) return setError(/duplicate|unique/i.test(error.message) ? 'A hotel with this name or code already exists.' : niceError(error));
    onCreated(data.id);
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Add hotel</h2>
        <label>Hotel name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></label>
        <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Tbilisi" /></label>
        <label>Code <span className="muted">(optional)</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. H134" /></label>
        <p className="hint">After saving you can add room types and set the systems and responsible people.</p>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Create hotel'}</button>
        </div>
      </form>
    </div>
  );
}

// ================================================================= HOTEL DETAIL
export function HotelDetail() {
  const { id } = useParams();
  const hotelId = Number(id);
  const { isManager } = useAuth();
  const [hotel, setHotel] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [cells, setCells] = useState([]);
  const [rules, setRules] = useState([]);
  const [systems, setSystems] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      const [h, r, c, ru, s, p] = await Promise.all([
        supabase.from('hotels').select('*').eq('id', hotelId).single(),
        supabase.from('room_types').select('*').eq('hotel_id', hotelId).order('sort_order').order('name'),
        supabase.from('v_matrix').select('*').eq('hotel_id', hotelId).order('sort_order'),
        supabase.from('hotel_rules').select('*').eq('hotel_id', hotelId).order('is_active', { ascending: false }).order('source_date', { ascending: false, nullsFirst: false }),
        supabase.from('systems').select('*').order('sort_order'),
        supabase.from('profiles').select('id, full_name, short_name, is_active').order('full_name'),
      ]);
      for (const x of [h, r, c, ru, s, p]) if (x.error) throw x.error;
      setHotel(h.data); setRooms(r.data); setCells(c.data); setRules(ru.data); setSystems(s.data); setPeople(p.data);
    } catch (e) { setError(niceError(e)); }
  }
  useEffect(() => { load(); }, [hotelId]);

  async function updateHotel(patch) {
    const { error } = await supabase.from('hotels').update(patch).eq('id', hotelId);
    if (error) return alert(niceError(error));
    setHotel({ ...hotel, ...patch });
  }

  if (error) return <div className="page"><div className="alert error">{error}</div><Link to="/hotels">← Back to hotels</Link></div>;
  if (!hotel) return <div className="page muted">Loading…</div>;

  const activeRules = rules.filter((r) => r.is_active);
  const oldRules = rules.filter((r) => !r.is_active);

  return (
    <div className="page">
      <Link to="/hotels" className="back">← All hotels</Link>
      <div className="page-head">
        <div>
          <h1>{hotel.name}</h1>
          <p className="muted">{[hotel.code, hotel.city, hotel.country].filter(Boolean).join(' · ')}{!hotel.is_active && ' · inactive hotel'}</p>
        </div>
        {isManager && <button className="btn" onClick={() => setEditing(true)}>Edit hotel</button>}
      </div>

      {hotel.no_prices_lock && (
        <div className="alert lockbox">
          <strong>!!!!! No prices — hotel locked.</strong> The whole hotel must stay closed. Only people with the “open no-prices” permission can remove the lock.
        </div>
      )}
      {hotel.notes && <div className="card note-card">{hotel.notes}</div>}

      <div className="grid-detail">
        <div>
          <SystemsCard hotel={hotel} cells={cells} systems={systems} people={people} canEdit={isManager} onChanged={load} />
        </div>
        <div>
          <RoomsCard hotelId={hotelId} rooms={rooms} canEdit={isManager} onChanged={load} />
          <RulesCard hotelId={hotelId} active={activeRules} old={oldRules} systems={systems} canEdit={isManager} onChanged={load} />
        </div>
      </div>

      {editing && <EditHotel hotel={hotel} onClose={() => setEditing(false)} onSave={async (patch) => { await updateHotel(patch); setEditing(false); }} />}
    </div>
  );
}

function EditHotel({ hotel, onClose, onSave }) {
  const { profile } = useAuth();
  const canLock = profile.can_open_no_prices || ['manager', 'admin'].includes(profile.role);
  const [form, setForm] = useState({ name: hotel.name, city: hotel.city || '', code: hotel.code || '', notes: hotel.notes || '', no_prices_lock: hotel.no_prices_lock, is_active: hotel.is_active });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, name: form.name.trim(), city: form.city.trim() || null, code: form.code.trim() || null, notes: form.notes.trim() || null }); }}>
        <h2>Edit hotel</h2>
        <label>Hotel name<input value={form.name} onChange={set('name')} required /></label>
        <label>City<input value={form.city} onChange={set('city')} /></label>
        <label>Code<input value={form.code} onChange={set('code')} /></label>
        <label>Notes<textarea rows={3} value={form.notes} onChange={set('notes')} /></label>
        <label className="check"><input type="checkbox" checked={form.no_prices_lock} onChange={set('no_prices_lock')} disabled={!canLock && hotel.no_prices_lock} />
          “!!!!!” No prices — lock the whole hotel (must stay closed)</label>
        <label className="check"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> We still work with this hotel (active)</label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- systems matrix for one hotel
function SystemsCard({ hotel, cells, systems, people, canEdit, onChanged }) {
  const [savedId, setSavedId] = useState(null);
  const bySystem = Object.fromEntries(cells.map((c) => [c.system_id, c]));
  const activePeople = people.filter((p) => p.is_active);

  async function save(system, patch) {
    const cur = bySystem[system.id] || {};
    const row = {
      hotel_id: hotel.id,
      system_id: system.id,
      status: cur.status || 'na',
      responsible_id: cur.responsible_id ?? null,
      responsible_excel_name: cur.responsible_excel_name ?? null,
      b2b_only: cur.b2b_only ?? false,
      partner_hotel_code: cur.partner_hotel_code ?? null,
      ...patch,
    };
    const { error } = await supabase.from('hotel_systems').upsert(row, { onConflict: 'hotel_id,system_id' });
    if (error) return alert(niceError(error));
    setSavedId(system.id); setTimeout(() => setSavedId(null), 1500);
    onChanged();
  }

  const active = cells.filter((c) => c.status === 'active').length;
  return (
    <div className="card">
      <h2>Systems <span className="muted small">· active in {active} of {systems.length}</span></h2>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>System</th><th>Status</th><th>Responsible</th><th title="Business-to-business only">B2B only</th><th>Hotel ID in system</th><th /></tr></thead>
          <tbody>
            {systems.map((s) => {
              const c = bySystem[s.id] || { status: 'na' };
              const unlinked = !c.responsible_id && c.responsible_excel_name;
              const inactivePerson = c.responsible_id && c.responsible_active === false;
              return (
                <tr key={s.id} className={`row-${c.status}`}>
                  <td><strong>{s.name}</strong>{!s.is_enabled && <span className="pill">off</span>}</td>
                  <td>
                    {canEdit ? (
                      <select value={c.status} onChange={(e) => save(s, { status: e.target.value })} className={`sel-${c.status}`}>
                        {STATUSES.map((x) => <option key={x.value} value={x.value} title={x.hint}>{x.label}</option>)}
                      </select>
                    ) : <span className={`pill st-${c.status}`}>{statusLabel(c.status)}</span>}
                  </td>
                  <td>
                    {canEdit ? (
                      <select value={c.responsible_id || ''} onChange={(e) => save(s, { responsible_id: e.target.value || null })}>
                        <option value="">{unlinked ? `${c.responsible_excel_name} (no account yet)` : '— nobody —'}</option>
                        {activePeople.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.short_name}</option>)}
                        {inactivePerson && <option value={c.responsible_id}>{c.responsible_name} (former member)</option>}
                      </select>
                    ) : (
                      <span>{c.responsible_name || (unlinked ? <em>{c.responsible_excel_name}</em> : <span className="muted">—</span>)}</span>
                    )}
                    {inactivePerson && <div className="hint warn-text">Former member — choose someone else</div>}
                  </td>
                  <td>
                    <input type="checkbox" checked={!!c.b2b_only} disabled={!canEdit} onChange={(e) => save(s, { b2b_only: e.target.checked })} />
                  </td>
                  <td>
                    {canEdit
                      ? <input className="code-input" defaultValue={c.partner_hotel_code || ''} placeholder="—"
                          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (c.partner_hotel_code || null)) save(s, { partner_hotel_code: v }); }} />
                      : <span className="muted">{c.partner_hotel_code || '—'}</span>}
                  </td>
                  <td className="saved">{savedId === s.id && '✓ saved'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Changes save immediately. New stop sales and openings will create tasks only for systems marked <strong>Active</strong>, assigned to the responsible person.</p>
    </div>
  );
}

// ---------------------------------------------------------------- room types
function RoomsCard({ hotelId, rooms, canEdit, onChanged }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from('room_types').insert({ hotel_id: hotelId, name: name.trim(), sort_order: rooms.length });
    if (error) return setError(/duplicate|unique/i.test(error.message) ? 'This room type already exists.' : niceError(error));
    setName(''); setError(''); onChanged();
  }
  async function rename(r) {
    const n = prompt('New name for this room type:', r.name);
    if (!n || n.trim() === r.name) return;
    const { error } = await supabase.from('room_types').update({ name: n.trim() }).eq('id', r.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  async function toggle(r) {
    const { error } = await supabase.from('room_types').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  return (
    <div className="card">
      <h2>Room types</h2>
      <ul className="rooms">
        <li className="whole"><span>Whole hotel</span><span className="muted small">always available</span></li>
        {rooms.map((r) => (
          <li key={r.id} className={r.is_active ? '' : 'inactive'}>
            <span>{r.name}{!r.is_active && <span className="pill">not used</span>}</span>
            {canEdit && (
              <span className="row-actions">
                <button className="btn small" onClick={() => rename(r)}>Rename</button>
                <button className="btn small" onClick={() => toggle(r)}>{r.is_active ? 'Not used' : 'Use again'}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="inline-add" onSubmit={add}>
          <input placeholder="Add room type, e.g. Standard Double" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn">Add</button>
        </form>
      )}
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- rules & notes
function RulesCard({ hotelId, active, old, systems, canEdit, onChanged }) {
  const { profile } = useAuth();
  const [showOld, setShowOld] = useState(false);
  const [form, setForm] = useState({ rule_type: 'note', text: '', system_id: '' });
  async function add(e) {
    e.preventDefault();
    if (!form.text.trim()) return;
    const { error } = await supabase.from('hotel_rules').insert({
      hotel_id: hotelId, rule_type: form.rule_type, text: form.text.trim(),
      system_id: form.system_id ? Number(form.system_id) : null,
      severity: form.rule_type === 'note' ? 'info' : 'warning',
      created_by: profile.id, source: 'Added in platform', source_date: new Date().toISOString().slice(0, 10),
    });
    if (error) return alert(niceError(error));
    setForm({ rule_type: 'note', text: '', system_id: '' }); onChanged();
  }
  async function toggle(r) {
    const { error } = await supabase.from('hotel_rules').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  const sysName = (sid) => systems.find((s) => s.id === sid)?.name;
  const Item = ({ r }) => (
    <li className={r.is_active ? '' : 'inactive'}>
      <div className="rule-head">
        <span className={`pill ${r.rule_type === 'note' ? '' : 'warn'}`}>{ruleLabel(r.rule_type)}</span>
        {r.system_id && <span className="pill">{sysName(r.system_id)}</span>}
        <span className="muted small">{[r.source, r.source_date && new Date(r.source_date).toLocaleDateString('en-GB')].filter(Boolean).join(' · ')}</span>
        {canEdit && <button className="link-btn small" onClick={() => toggle(r)}>{r.is_active ? 'Archive' : 'Restore'}</button>}
      </div>
      <div className="rule-text">{r.text}</div>
    </li>
  );
  return (
    <div className="card">
      <h2>Rules &amp; notes <span className="muted small">· shown as warnings when someone creates a change</span></h2>
      {!active.length && <p className="muted">No active rules or notes.</p>}
      <ul className="rules">{active.map((r) => <Item key={r.id} r={r} />)}</ul>
      {old.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowOld(!showOld)}>{showOld ? 'Hide' : 'Show'} archived / old Excel notes ({old.length})</button>
          {showOld && <ul className="rules">{old.map((r) => <Item key={r.id} r={r} />)}</ul>}
        </>
      )}
      {canEdit && (
        <form className="rule-add" onSubmit={add}>
          <div className="row2">
            <select value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })}>
              {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={form.system_id} onChange={(e) => setForm({ ...form, system_id: e.target.value })}>
              <option value="">All systems</option>
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <textarea rows={2} placeholder="Rule or note…" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          <button className="btn">Add rule / note</button>
        </form>
      )}
    </div>
  );
}

// ================================================================= SYSTEMS PAGE
export function Systems() {
  const { isAdmin } = useAuth();
  const [systems, setSystems] = useState([]);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  async function load() {
    const { data, error } = await supabase.from('systems').select('*').order('sort_order');
    if (error) return setError(niceError(error));
    setSystems(data);
    const cells = await fetchAll('hotel_systems', 'system_id, status', (q) => q.eq('status', 'active'));
    setCounts(countBy(cells, 'system_id'));
  }
  useEffect(() => { load(); }, []);
  async function save(s, patch) {
    const { error } = await supabase.from('systems').update(patch).eq('id', s.id);
    if (error) return alert(niceError(error));
    load();
  }
  return (
    <div className="page">
      <h1>Systems</h1>
      <p className="muted">The distribution systems where stop sales and openings are made.{!isAdmin && ' Only admins can edit this page.'}</p>
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>System</th><th>Hotels active</th><th>How it is updated</th><th>Extranet link</th><th>In use</th></tr></thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className={s.is_enabled ? '' : 'inactive'}>
                  <td><strong>{s.name}</strong></td>
                  <td>{counts[s.id] || 0}</td>
                  <td>{s.update_method === 'manual' ? 'Manually in the extranet' : s.update_method === 'robot' ? 'Robot' : 'API'}</td>
                  <td>
                    {isAdmin
                      ? <input className="url-input" defaultValue={s.extranet_url || ''} placeholder="https://…"
                          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (s.extranet_url || null)) save(s, { extranet_url: v }); }} />
                      : s.extranet_url ? <a href={s.extranet_url} target="_blank" rel="noreferrer">Open ↗</a> : <span className="muted">—</span>}
                  </td>
                  <td><input type="checkbox" checked={s.is_enabled} disabled={!isAdmin} onChange={(e) => save(s, { is_enabled: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">Robots for extranets come in Phase 2. Until then every system is updated manually, and the platform tracks who did it.</p>
    </div>
  );
}

// ================================================================= Team page helper: Excel names without accounts
export function UnlinkedExcelNames() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchAll('hotel_systems', 'responsible_excel_name', (q) => q.is('responsible_id', null).not('responsible_excel_name', 'is', null).eq('status', 'active'))
      .then((d) => setRows(Object.entries(countBy(d, 'responsible_excel_name')).sort((a, b) => b[1] - a[1])))
      .catch(() => setRows([]));
  }, []);
  if (!rows || !rows.length) return null;
  return (
    <div className="alert info">
      <strong>Names from the old Excel without an account:</strong>{' '}
      {rows.map(([n, c], i) => <span key={n}>{i > 0 && ', '}<strong>{n}</strong> ({c} hotel × system)</span>)}.
      <div>When you create (or edit) an account and enter exactly this name in “Name in the old Excel”, all those hotels are linked to that person automatically.</div>
    </div>
  );
}
