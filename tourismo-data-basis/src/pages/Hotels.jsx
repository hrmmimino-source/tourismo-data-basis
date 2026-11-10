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

// person filter value: '' | 'me' | '<profile id>' | 'excel:<old Excel name>'
function personMatch(cell, person, meId) {
  if (!person) return true;
  if (person === 'me') return cell.responsible_id === meId;
  if (person.startsWith('excel:')) return !cell.responsible_id && cell.responsible_excel_name === person.slice(6);
  return cell.responsible_id === person;
}

// everyone who is responsible for at least one cell (accounts + old Excel names)
function personOptionsOf(cells) {
  const names = new Map();
  for (const c of cells) {
    if (!c.responsible_id && !c.responsible_excel_name) continue;
    const key = c.responsible_id || `excel:${c.responsible_excel_name}`;
    names.set(key, c.responsible_id
      ? `${c.responsible_name || c.responsible_short}${c.responsible_active === false ? ' (former member)' : ''}`
      : `${c.responsible_excel_name} (no account yet)`);
  }
  return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

// save one hotel × system cell (status / responsible / hotel ID in that system)
export async function saveCell(hotelId, systemId, cur, patch) {
  const row = {
    hotel_id: hotelId,
    system_id: systemId,
    status: cur?.status || 'na',
    responsible_id: cur?.responsible_id ?? null,
    responsible_excel_name: cur?.responsible_excel_name ?? null,
    b2b_only: cur?.b2b_only ?? false,
    partner_hotel_code: cur?.partner_hotel_code ?? null,
    ...patch,
  };
  const { error } = await supabase.from('hotel_systems').upsert(row, { onConflict: 'hotel_id,system_id' });
  if (error) { alert(niceError(error)); return false; }
  return true;
}

function StatusSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`sel-${value}`}>
      {STATUSES.map((x) => <option key={x.value} value={x.value} title={x.hint}>{x.label}</option>)}
    </select>
  );
}

function PersonSelect({ cell, people, onChange }) {
  const unlinked = !cell.responsible_id && cell.responsible_excel_name;
  const formerMember = cell.responsible_id && cell.responsible_active === false;
  return (
    <>
      <select value={cell.responsible_id || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{unlinked ? `${cell.responsible_excel_name} (no account yet)` : '— nobody —'}</option>
        {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.short_name}</option>)}
        {formerMember && <option value={cell.responsible_id}>{cell.responsible_name} (former member)</option>}
      </select>
      {formerMember && <div className="hint warn-text">Former member — choose someone else</div>}
    </>
  );
}

function PersonView({ cell }) {
  if (cell.responsible_name) return <span>{cell.responsible_name}</span>;
  if (cell.responsible_excel_name) return <em>{cell.responsible_excel_name}</em>;
  return <span className="muted">—</span>;
}

function HotelCodeInput({ cell, onSave }) {
  return (
    <input className="code-input" defaultValue={cell.partner_hotel_code || ''} placeholder="—"
      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (cell.partner_hotel_code || null)) onSave(v); }} />
  );
}

const STATUS_FILTERS = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive (closed now)' },
  { value: 'not_active', label: 'Not active (not in our account)' },
  { value: 'na', label: 'N/A' },
];

// ================================================================= HOTELS PAGE (list + matrix)
export default function Hotels() {
  const { profile: me, isManager } = useAuth();
  const navigate = useNavigate();
  const [hotels, setHotels] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [cells, setCells] = useState([]);
  const [rules, setRules] = useState([]);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('hotels.view') || 'list'; } catch { return 'list'; } });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [person, setPerson] = useState('');
  const [system, setSystem] = useState('');
  const [stat, setStat] = useState('');
  const [noActive, setNoActive] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { try { localStorage.setItem('hotels.view', view); } catch { /* ignore */ } }, [view]);

  useEffect(() => {
    (async () => {
      try {
        const [h, r, c, ru, s] = await Promise.all([
          fetchAll('hotels', '*', (x) => x.order('name')),
          fetchAll('room_types', 'id, hotel_id, is_active'),
          fetchAll('v_matrix', 'hotel_id, system_id, status, responsible_id, responsible_excel_name, responsible_name, responsible_short, responsible_active'),
          fetchAll('hotel_rules', 'id, hotel_id, is_active, rule_type'),
          fetchAll('systems', '*', (x) => x.order('sort_order')),
        ]);
        setHotels(h); setRooms(r); setCells(c); setRules(ru); setSystems(s);
      } catch (e) { setError(niceError(e)); }
      setLoading(false);
    })();
  }, []);

  const byHotel = useMemo(() => {
    const m = {};
    for (const c of cells) (m[c.hotel_id] ||= {})[c.system_id] = c;
    return m;
  }, [cells]);
  const cellOf = (hotelId, systemId) => byHotel[hotelId]?.[systemId] || { hotel_id: hotelId, system_id: systemId, status: 'na' };
  const roomCount = useMemo(() => countBy(rooms.filter((r) => r.is_active), 'hotel_id'), [rooms]);
  const ruleCount = useMemo(() => countBy(rules.filter((r) => r.is_active && r.rule_type !== 'note'), 'hotel_id'), [rules]);
  const cities = useMemo(() => [...new Set(hotels.map((h) => h.city).filter(Boolean))].sort(), [hotels]);
  const personOptions = useMemo(() => personOptionsOf(cells), [cells]);
  const archivedCount = hotels.filter((h) => !h.is_active).length;

  // a cell "matches" when it fits the system / status / responsible filters
  const cellFilterOn = !!(system || stat || person);
  const cellMatches = (c) => {
    if (system && c.system_id !== Number(system)) return false;
    if (stat && c.status !== stat) return false;
    if (!stat && system && c.status === 'na') return false;
    if (person && !personMatch(c, person, me.id)) return false;
    return true;
  };

  const shown = useMemo(() => hotels.filter((h) => {
    if (!showArchived && !h.is_active) return false;
    if (city && h.city !== city) return false;
    if (q && !(`${h.name} ${h.code || ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (noActive && systems.some((s) => cellOf(h.id, s.id).status === 'active')) return false;
    if (cellFilterOn && !systems.some((s) => cellMatches(cellOf(h.id, s.id)))) return false;
    return true;
  }), [hotels, systems, q, city, person, system, stat, noActive, showArchived, byHotel]);

  // totals of the shown hotels, per status (only cells that match the filters)
  const totals = useMemo(() => {
    const t = { active: 0, inactive: 0, not_active: 0, na: 0 };
    for (const h of shown) for (const s of systems) {
      const c = cellOf(h.id, s.id);
      if (!cellFilterOn || cellMatches(c)) t[c.status]++;
    }
    return t;
  }, [shown, systems, byHotel, system, stat, person]);

  const clearFilters = () => { setQ(''); setCity(''); setPerson(''); setSystem(''); setStat(''); setNoActive(false); };
  const anyFilter = q || city || person || system || stat || noActive;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Hotels &amp; systems</h1>
          <p className="muted">{hotels.length - archivedCount} hotels we work with{archivedCount > 0 && ` · ${archivedCount} archived`} · who handles which hotel in which system</p>
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
        <select value={stat} onChange={(e) => setStat(e.target.value)} className={stat ? `sel-${stat}` : ''}>
          {STATUS_FILTERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <select value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Anyone responsible</option>
          <option value="me">Me</option>
          {personOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={noActive} onChange={(e) => setNoActive(e.target.checked)} /> Not active in any system</label>
        <label className="check" title={archivedCount ? '' : 'No hotel is archived yet. To archive one: open the hotel → Edit hotel → untick “We still work with this hotel”.'}>
          <input type="checkbox" checked={showArchived} disabled={!archivedCount && !showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived hotels ({archivedCount})
        </label>
        {anyFilter && <button className="link-btn small" onClick={clearFilters}>Clear filters</button>}
        <span className="muted count">{shown.length} hotels</span>
      </div>

      <div className="totals">
        <span className="muted small">{cellFilterOn ? 'Matching hotel × system cells:' : 'Hotel × system cells:'}</span>
        <span className="cnt cnt-active">{totals.active}</span> active
        <span className="cnt cnt-inactive">{totals.inactive}</span> inactive
        <span className="cnt cnt-not_active">{totals.not_active}</span> not active
        <span className="cnt cnt-na">{totals.na}</span> N/A
      </div>

      {loading ? <div className="card muted">Loading…</div> : view === 'list' ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table clickable">
              <thead><tr><th>Code</th><th>Hotel</th><th>City</th><th>Room types</th><th title="Number of systems where the hotel is Active / Inactive / Not active">Systems: active · inactive · not active</th><th>Rules</th><th>Flags</th></tr></thead>
              <tbody>
                {shown.map((h) => {
                  const row = byHotel[h.id] || {};
                  const cnt = (st) => Object.values(row).filter((c) => c.status === st).length;
                  return (
                    <tr key={h.id} onClick={() => navigate(`/hotels/${h.id}`)} className={h.is_active ? '' : 'inactive'}>
                      <td className="muted">{h.code}</td>
                      <td><strong>{h.name}</strong></td>
                      <td>{h.city || <span className="muted">—</span>}</td>
                      <td>{roomCount[h.id] || <span className="muted">whole hotel</span>}</td>
                      <td className="nowrap"><span className="cnt cnt-active" title="Active">{cnt('active')}</span><span className="cnt cnt-inactive" title="Inactive (closed now)">{cnt('inactive')}</span><span className="cnt cnt-not_active" title="Not active (not in our account)">{cnt('not_active')}</span></td>
                      <td>{ruleCount[h.id] ? <span className="pill warn">{ruleCount[h.id]}</span> : <span className="muted">—</span>}</td>
                      <td>
                        {h.no_prices_lock && <span className="pill lock">!!!!! no prices</span>}
                        {!h.is_active && <span className="pill">archived</span>}
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
            <span><i className="sw st-active" /> Active</span>
            <span><i className="sw st-inactive" /> Inactive (closed now)</span>
            <span><i className="sw st-not_active" /> Not active</span>
            <span><i className="sw st-na" /> N/A</span>
            <span>Names = responsible person · <em>italic</em> = name from the old Excel, no account yet</span>
            {cellFilterOn && <span className="muted">Faded cells don’t match the filters</span>}
          </div>
          <div className="table-wrap matrix-wrap">
            <table className="matrix">
              <thead><tr><th className="sticky">Hotel</th>{systems.map((s) => <th key={s.id} className={system && Number(system) === s.id ? 'col-on' : ''}><Link to={`/systems/${s.id}`}><span>{s.name}</span></Link></th>)}</tr></thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.id} className={h.is_active ? '' : 'archived'}>
                    <td className="sticky"><Link to={`/hotels/${h.id}`}>{h.name}</Link></td>
                    {systems.map((s) => {
                      const c = cellOf(h.id, s.id);
                      const dim = cellFilterOn && !cellMatches(c);
                      const who = personText(c);
                      return (
                        <td key={s.id} className={`st-${c.status} ${dim ? 'dim' : ''}`} title={`${h.name} · ${s.name}: ${statusLabel(c.status)}${who ? ` · ${who}` : ''}`}>
                          {who ? (c.responsible_id ? who : <em>{who}</em>) : c.status === 'active' ? <em>?</em> : c.status === 'inactive' ? 'closed' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!shown.length && <tr><td className="sticky muted" colSpan={systems.length + 1}>No hotels match these filters.</td></tr>}
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
          <p className="muted">{[hotel.code, hotel.city, hotel.country].filter(Boolean).join(' · ')}{!hotel.is_active && ' · archived hotel'}</p>
        </div>
        {isManager && <button className="btn" onClick={() => setEditing(true)}>Edit hotel</button>}
      </div>

      {hotel.no_prices_lock && (
        <div className="alert lockbox">
          <strong>!!!!! No prices — hotel locked.</strong> The whole hotel must stay closed. Only people with the “open no-prices” permission can remove the lock.
        </div>
      )}
      {hotel.notes && <div className="card note-card">{hotel.notes}</div>}

      <SystemsCard hotel={hotel} cells={cells} systems={systems} people={people} canEdit={isManager} onChanged={load} />
      <div className="grid-detail">
        <RoomsCard hotelId={hotelId} rooms={rooms} canEdit={isManager} onChanged={load} />
        <RulesCard hotelId={hotelId} active={activeRules} old={oldRules} systems={systems} canEdit={isManager} onChanged={load} />
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
        <label className="check"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> We still work with this hotel (untick to archive it)</label>
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

  async function save(system, patch) {
    if (!(await saveCell(hotel.id, system.id, bySystem[system.id], patch))) return;
    setSavedId(system.id); setTimeout(() => setSavedId(null), 1500);
    onChanged();
  }

  const n = (st) => systems.filter((s) => (bySystem[s.id]?.status || 'na') === st).length;
  return (
    <div className="card">
      <h2>Systems <span className="muted small">· {n('active')} active · {n('inactive')} inactive · {n('not_active')} not active · {n('na')} N/A</span></h2>
      <div className="table-wrap">
        <table className="table compact systems-table">
          <thead><tr><th>System</th><th>Status</th><th>Responsible</th><th>Hotel ID in system <span className="muted small">(optional)</span></th><th /></tr></thead>
          <tbody>
            {systems.map((s) => {
              const c = bySystem[s.id] || { status: 'na' };
              return (
                <tr key={s.id} className={`row-${c.status}`}>
                  <td><Link to={`/systems/${s.id}`} className="plain-link"><strong>{s.name}</strong></Link>{!s.is_enabled && <span className="pill">off</span>}</td>
                  <td>{canEdit ? <StatusSelect value={c.status} onChange={(v) => save(s, { status: v })} /> : <span className={`pill st-${c.status}`}>{statusLabel(c.status)}</span>}</td>
                  <td>{canEdit ? <PersonSelect cell={c} people={people} onChange={(v) => save(s, { responsible_id: v })} /> : <PersonView cell={c} />}</td>
                  <td>{canEdit ? <HotelCodeInput cell={c} onSave={(v) => save(s, { partner_hotel_code: v })} /> : <span className="muted">{c.partner_hotel_code || '—'}</span>}</td>
                  <td className="saved">{savedId === s.id && '✓ saved'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Changes save immediately. New stop sales and openings will create tasks only for systems marked <strong>Active</strong>, assigned to the responsible person. Hotel IDs are optional: fill them in when you know them (they will help the robots later).</p>
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
function SystemPicker({ systems, value, onChange }) {
  const [open, setOpen] = useState(false);
  const names = value.map((id) => systems.find((s) => s.id === id)?.name).filter(Boolean);
  const label = !value.length ? 'All systems' : value.length <= 2 ? names.join(', ') : `${value.length} systems`;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="picker">
      <button type="button" className="picker-btn" onClick={() => setOpen(!open)}>{label} <span className="muted">▾</span></button>
      {open && (
        <>
          <div className="picker-backdrop" onClick={() => setOpen(false)} />
          <div className="picker-pop">
            <label className="check"><input type="checkbox" checked={!value.length} onChange={() => onChange([])} /> All systems</label>
            <div className="picker-sep" />
            {systems.map((s) => (
              <label key={s.id} className="check"><input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}</label>
            ))}
            <button type="button" className="btn small picker-done" onClick={() => setOpen(false)}>Done</button>
          </div>
        </>
      )}
    </div>
  );
}

function QuickNotesDialog({ notes, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('note');
  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const { error } = await supabase.from('quick_notes').insert({ text: text.trim(), rule_type: type, sort_order: notes.length + 1 });
    if (error) return alert(niceError(error));
    setText(''); setType('note'); onChanged();
  }
  async function remove(n) {
    if (!confirm(`Remove the quick note “${n.text}” from the list? Notes already added to hotels stay.`)) return;
    const { error } = await supabase.from('quick_notes').delete().eq('id', n.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Quick notes</h2>
        <p className="hint">One-click notes for every hotel page. Managers and admins can change this list.</p>
        <ul className="quick-list">
          {notes.map((n) => (
            <li key={n.id}>
              <span><span className={`pill ${n.rule_type === 'note' ? '' : 'warn'}`}>{ruleLabel(n.rule_type)}</span> {n.text}</span>
              <button className="btn small danger" onClick={() => remove(n)}>Delete</button>
            </li>
          ))}
          {!notes.length && <li className="muted">No quick notes yet.</li>}
        </ul>
        <form className="rule-add" onSubmit={add}>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input placeholder="New quick note, e.g. არ გვაქვს ფასი ამ პერიოდზე" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn">Add to list</button>
        </form>
        <div className="modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function RulesCard({ hotelId, active, old, systems, canEdit, onChanged }) {
  const { profile } = useAuth();
  const [showOld, setShowOld] = useState(false);
  const [form, setForm] = useState({ rule_type: 'note', text: '', system_ids: [] });
  const [quick, setQuick] = useState([]);
  const [managing, setManaging] = useState(false);
  const loadQuick = () => supabase.from('quick_notes').select('*').order('sort_order').order('id').then(({ data }) => setQuick(data || []));
  useEffect(() => { loadQuick(); }, []);

  async function insertRule({ rule_type, text, system_ids }) {
    const { error } = await supabase.from('hotel_rules').insert({
      hotel_id: hotelId, rule_type, text,
      system_ids: system_ids.length ? system_ids : null,
      severity: rule_type === 'note' ? 'info' : 'warning',
      created_by: profile.id, source: 'Added in platform', source_date: new Date().toISOString().slice(0, 10),
    });
    if (error) { alert(niceError(error)); return false; }
    onChanged();
    return true;
  }
  async function add(e) {
    e.preventDefault();
    if (!form.text.trim()) return;
    if (await insertRule({ ...form, text: form.text.trim() })) setForm({ rule_type: 'note', text: '', system_ids: [] });
  }
  async function toggle(r) {
    const { error } = await supabase.from('hotel_rules').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  async function remove(r) {
    if (!confirm('Delete this note permanently? (Use “Archive” instead if you want to keep it in the history.)')) return;
    const { error } = await supabase.from('hotel_rules').delete().eq('id', r.id);
    if (error) return alert(niceError(error));
    onChanged();
  }
  const sysNames = (r) => {
    const ids = r.system_ids?.length ? r.system_ids : (r.system_id ? [r.system_id] : []);
    return ids.map((id) => systems.find((s) => s.id === id)?.name).filter(Boolean);
  };
  const Item = ({ r }) => (
    <li className={r.is_active ? '' : 'inactive'}>
      <div className="rule-head">
        <span className={`pill ${r.rule_type === 'note' ? '' : 'warn'}`}>{ruleLabel(r.rule_type)}</span>
        {sysNames(r).map((n) => <span key={n} className="pill sys">{n}</span>)}
        <span className="muted small">{[r.source, r.source_date && new Date(r.source_date).toLocaleDateString('en-GB')].filter(Boolean).join(' · ')}</span>
        {canEdit && (
          <span className="rule-actions">
            <button className="link-btn small" onClick={() => toggle(r)}>{r.is_active ? 'Archive' : 'Restore'}</button>
            <button className="link-btn small danger-text" onClick={() => remove(r)}>Delete</button>
          </span>
        )}
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
        <form className="quick-box" onSubmit={add}>
          <div className="quick-head">
            <strong>Add note</strong>
            <span className="muted small">for</span>
            <SystemPicker systems={systems} value={form.system_ids} onChange={(ids) => setForm({ ...form, system_ids: ids })} />
          </div>
          <div className="note-row">
            <textarea rows={2} placeholder="Write a note…" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            <button className="btn">Add note</button>
          </div>
          <div className="quick">
            <span className="muted small">Quick notes (one click):</span>
            {quick.map((q) => (
              <button type="button" key={q.id} className="chip" onClick={() => insertRule({ rule_type: q.rule_type, text: q.text, system_ids: form.system_ids })}>＋ {q.text}</button>
            ))}
            <button type="button" className="link-btn small" onClick={() => setManaging(true)}>Edit list</button>
          </div>
        </form>
      )}
      {managing && <QuickNotesDialog notes={quick} onClose={() => setManaging(false)} onChanged={loadQuick} />}
    </div>
  );
}

// ================================================================= SYSTEMS PAGE
const methodLabel = (m) => (m === 'manual' ? 'Manually in the extranet' : m === 'robot' ? 'Robot' : 'API');

export function Systems() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [systems, setSystems] = useState([]);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  async function load() {
    const { data, error } = await supabase.from('systems').select('*').order('sort_order');
    if (error) return setError(niceError(error));
    setSystems(data);
    const [cells, hotels] = await Promise.all([
      fetchAll('hotel_systems', 'hotel_id, system_id, status'),
      fetchAll('hotels', 'id, is_active'),
    ]);
    const working = new Set(hotels.filter((h) => h.is_active).map((h) => h.id));
    const m = {};
    for (const s of data) m[s.id] = { active: 0, inactive: 0, not_active: 0, na: 0 };
    for (const c of cells) if (m[c.system_id] && working.has(c.hotel_id) && c.status !== 'na') m[c.system_id][c.status]++;
    for (const s of data) { const x = m[s.id]; x.na = Math.max(0, working.size - x.active - x.inactive - x.not_active); }
    setCounts(m);
  }
  useEffect(() => { load(); }, []);
  async function save(s, patch) {
    const { error } = await supabase.from('systems').update(patch).eq('id', s.id);
    if (error) return alert(niceError(error));
    load();
  }
  const stop = (e) => e.stopPropagation();
  return (
    <div className="page">
      <h1>Systems</h1>
      <p className="muted">The distribution systems where stop sales and openings are made. Click a system to see and manage its hotels.{!isAdmin && ' Only admins can change the link and “In use”.'}</p>
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <div className="table-wrap">
          <table className="table clickable">
            <thead><tr><th>System</th><th>Active</th><th>Inactive</th><th>Not active</th><th>N/A</th><th>How it is updated</th><th>Extranet link</th><th>In use</th></tr></thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className={s.is_enabled ? '' : 'inactive'} onClick={() => navigate(`/systems/${s.id}`)}>
                  <td><Link to={`/systems/${s.id}`} className="plain-link"><strong>{s.name}</strong></Link> <span className="muted small">›</span></td>
                  <td><span className="cnt cnt-active">{counts[s.id]?.active ?? 0}</span></td>
                  <td><span className="cnt cnt-inactive">{counts[s.id]?.inactive ?? 0}</span></td>
                  <td><span className="cnt cnt-not_active">{counts[s.id]?.not_active ?? 0}</span></td>
                  <td><span className="cnt cnt-na">{counts[s.id]?.na ?? 0}</span></td>
                  <td>{methodLabel(s.update_method)}</td>
                  <td onClick={stop}>
                    {isAdmin
                      ? <input className="url-input" defaultValue={s.extranet_url || ''} placeholder="https://…"
                          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (s.extranet_url || null)) save(s, { extranet_url: v }); }} />
                      : s.extranet_url ? <a href={s.extranet_url} target="_blank" rel="noreferrer">Open ↗</a> : <span className="muted">—</span>}
                  </td>
                  <td onClick={stop}><input type="checkbox" checked={s.is_enabled} disabled={!isAdmin} onChange={(e) => save(s, { is_enabled: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">Counts are for hotels we work with (archived hotels are not counted). Robots for extranets come in Phase 2. Until then every system is updated manually, and the platform tracks who did it.</p>
    </div>
  );
}

// ================================================================= ONE SYSTEM: all its hotels
export function SystemDetail() {
  const { id } = useParams();
  const systemId = Number(id);
  const { isManager, isAdmin, profile: me } = useAuth();
  const [system, setSystem] = useState(null);
  const [hotels, setHotels] = useState([]);
  const [cells, setCells] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [stat, setStat] = useState('');
  const [person, setPerson] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [savedId, setSavedId] = useState(null);

  async function loadCells() {
    setCells(await fetchAll('v_matrix', '*', (x) => x.eq('system_id', systemId)));
  }
  async function load() {
    try {
      const [s, h, p] = await Promise.all([
        supabase.from('systems').select('*').eq('id', systemId).single(),
        fetchAll('hotels', '*', (x) => x.order('name')),
        supabase.from('profiles').select('id, full_name, short_name, is_active').order('full_name'),
      ]);
      for (const x of [s, p]) if (x.error) throw x.error;
      setSystem(s.data); setHotels(h); setPeople(p.data);
      await loadCells();
    } catch (e) { setError(niceError(e)); }
  }
  useEffect(() => { setSystem(null); load(); }, [systemId]);

  const byHotel = useMemo(() => Object.fromEntries(cells.map((c) => [c.hotel_id, c])), [cells]);
  const cellOf = (h) => byHotel[h.id] || { hotel_id: h.id, system_id: systemId, status: 'na' };
  const cities = useMemo(() => [...new Set(hotels.map((h) => h.city).filter(Boolean))].sort(), [hotels]);
  const personOptions = useMemo(() => personOptionsOf(cells), [cells]);
  const working = hotels.filter((h) => h.is_active);
  const archivedCount = hotels.length - working.length;
  const n = (st) => working.filter((h) => cellOf(h).status === st).length;

  const shown = hotels.filter((h) => {
    if (!showArchived && !h.is_active) return false;
    if (city && h.city !== city) return false;
    if (q && !(`${h.name} ${h.code || ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
    const c = cellOf(h);
    if (stat && c.status !== stat) return false;
    if (person && !personMatch(c, person, me.id)) return false;
    return true;
  });

  async function save(h, patch) {
    if (!(await saveCell(h.id, systemId, byHotel[h.id], patch))) return;
    setSavedId(h.id); setTimeout(() => setSavedId(null), 1500);
    loadCells();
  }
  async function saveSystem(patch) {
    const { error } = await supabase.from('systems').update(patch).eq('id', systemId);
    if (error) return alert(niceError(error));
    setSystem({ ...system, ...patch });
  }

  if (error) return <div className="page"><div className="alert error">{error}</div><Link to="/systems">← Back to systems</Link></div>;
  if (!system) return <div className="page muted">Loading…</div>;

  return (
    <div className="page wide">
      <Link to="/systems" className="back">← All systems</Link>
      <div className="page-head">
        <div>
          <h1>{system.name}{!system.is_enabled && <span className="pill">not in use</span>}</h1>
          <p className="muted">{methodLabel(system.update_method)}{system.extranet_url && <> · <a href={system.extranet_url} target="_blank" rel="noreferrer">Open extranet ↗</a></>}</p>
        </div>
        {isAdmin && (
          <div className="sys-settings">
            <input className="url-input" defaultValue={system.extranet_url || ''} placeholder="Extranet link https://…"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (system.extranet_url || null)) saveSystem({ extranet_url: v }); }} />
            <label className="check"><input type="checkbox" checked={system.is_enabled} onChange={(e) => saveSystem({ is_enabled: e.target.checked })} /> In use</label>
          </div>
        )}
      </div>

      <div className="status-chips">
        {STATUSES.map((st) => (
          <button key={st.value} className={`chip-filter ${stat === st.value ? 'on' : ''}`} title={st.hint} onClick={() => setStat(stat === st.value ? '' : st.value)}>
            <span className={`cnt cnt-${st.value}`}>{n(st.value)}</span> {st.label}
          </button>
        ))}
      </div>

      <div className="filters card">
        <input placeholder="Search hotel…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>
          {cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={stat} onChange={(e) => setStat(e.target.value)} className={stat ? `sel-${stat}` : ''}>
          {STATUS_FILTERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <select value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Anyone responsible</option>
          <option value="me">Me</option>
          {personOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="check" title={archivedCount ? '' : 'No hotel is archived yet.'}>
          <input type="checkbox" checked={showArchived} disabled={!archivedCount && !showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived hotels ({archivedCount})
        </label>
        <span className="muted count">{shown.length} hotels</span>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          <table className="table compact sys-hotels">
            <thead><tr><th>Code</th><th>Hotel</th><th>City</th><th>Status</th><th>Responsible</th><th>Hotel ID in {system.name} <span className="muted small">(optional)</span></th><th /></tr></thead>
            <tbody>
              {shown.map((h) => {
                const c = cellOf(h);
                return (
                  <tr key={h.id} className={`row-${c.status} ${h.is_active ? '' : 'inactive'}`}>
                    <td className="muted">{h.code}</td>
                    <td>
                      <Link to={`/hotels/${h.id}`} className="plain-link"><strong>{h.name}</strong></Link>
                      {h.no_prices_lock && <span className="pill lock">!!!!!</span>}
                      {!h.is_active && <span className="pill">archived</span>}
                    </td>
                    <td>{h.city || <span className="muted">—</span>}</td>
                    <td>{isManager ? <StatusSelect value={c.status} onChange={(v) => save(h, { status: v })} /> : <span className={`pill st-${c.status}`}>{statusLabel(c.status)}</span>}</td>
                    <td>{isManager ? <PersonSelect cell={c} people={people} onChange={(v) => save(h, { responsible_id: v })} /> : <PersonView cell={c} />}</td>
                    <td>{isManager ? <HotelCodeInput key={`${h.id}-${c.partner_hotel_code || ''}`} cell={c} onSave={(v) => save(h, { partner_hotel_code: v })} /> : <span className="muted">{c.partner_hotel_code || '—'}</span>}</td>
                    <td className="saved">{savedId === h.id && '✓ saved'}</td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={7} className="muted">No hotels match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">Changes save immediately and are the same as on each hotel’s page. Click a hotel name to open the hotel.</p>
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
