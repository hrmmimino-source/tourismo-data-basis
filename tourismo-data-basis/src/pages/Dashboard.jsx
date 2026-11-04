import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const STEPS = [
  { n: 1, title: 'Database', done: true },
  { n: 2, title: 'Login & team accounts', done: true },
  { n: 3, title: 'Hotels, room types, responsibility matrix' },
  { n: 4, title: 'New change form & task lists' },
  { n: 5, title: 'Calendar & history' },
  { n: 6, title: 'Import of the checked Excel data' },
  { n: 7, title: 'Pilot with the team' },
];

export default function Dashboard() {
  const { profile, isAdmin } = useAuth();
  const first = (profile.full_name || '').split(' ')[0];
  return (
    <div className="page">
      <h1>Hello{first ? `, ${first}` : ''}</h1>
      <p className="muted">This is the new Data Basis platform. It is being built step by step — the parts marked “soon” are on their way.</p>

      <div className="grid2">
        <div className="card">
          <h2>Build progress</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n} className={s.done ? 'done' : ''}>
                <span className="step-dot">{s.done ? '✓' : s.n}</span>{s.title}
              </li>
            ))}
          </ol>
        </div>
        <div className="card">
          <h2>What you can do now</h2>
          <ul className="plain">
            <li><Link to="/account">Change your password</Link></li>
            <li><Link to="/team">See the team</Link></li>
            {isAdmin && <li><Link to="/team">Add team members and set their roles</Link></li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
