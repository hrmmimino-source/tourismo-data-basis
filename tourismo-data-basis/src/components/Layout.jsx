import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { roleLabel } from '../labels.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/new', label: 'New change', icon: '＋', soon: true },
  { to: '/tasks', label: 'Tasks', icon: '☑', soon: true },
  { to: '/calendar', label: 'Calendar', icon: '▦', soon: true },
  { to: '/hotels', label: 'Hotels & systems', icon: '⌂', soon: true },
  { to: '/team', label: 'Team', icon: '☺' },
];

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
        <img src="./logo.png" alt="Tourismo" className="topbar-logo" />
      </header>

      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <img src="./logo.png" alt="Tourismo" />
          <span>Data Basis</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.soon && <span className="soon">soon</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/account" className={`me ${location.pathname === '/account' ? 'active' : ''}`}>
            <span className="avatar">{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span>
            <span className="me-text">
              <strong>{profile.full_name || profile.email}</strong>
              <small>{roleLabel(profile.role)}</small>
            </span>
          </NavLink>
          <button className="link-btn" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
