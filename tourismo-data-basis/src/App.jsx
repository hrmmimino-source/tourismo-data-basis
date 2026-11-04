import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Team from './pages/Team.jsx';
import Account from './pages/Account.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Hotels, { HotelDetail, Systems } from './pages/Hotels.jsx';

function FullScreenMessage({ title, text, action }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src="./logo.png" alt="Tourismo" className="auth-logo" />
        <h1>{title}</h1>
        <p className="muted">{text}</p>
        {action}
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, profileError, loading, mustChangePassword, signOut } = useAuth();

  if (session === undefined) return <FullScreenMessage title="Loading…" text="" />;
  if (!session) return <Login />;
  if (loading) return <FullScreenMessage title="Loading…" text="" />;

  if (!profile || !profile.is_active) {
    return (
      <FullScreenMessage
        title="Account not active"
        text={profileError
          ? `Could not load your account: ${profileError}`
          : 'This account is not active in the Data Basis platform. Please contact your manager.'}
        action={<button className="btn" onClick={signOut}>Sign out</button>}
      />
    );
  }

  if (mustChangePassword) return <ChangePassword firstLogin />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<ComingSoon title="New change" step={4}
          text="The Close / Open form: choose systems, hotels, room types and dates, see a preview, and create the tasks." />} />
        <Route path="/tasks" element={<ComingSoon title="Tasks" step={4}
          text="My tasks, team tasks, “I’ll take this”, Done, and reassigning by managers." />} />
        <Route path="/calendar" element={<ComingSoon title="Calendar" step={5}
          text="Month view per hotel: which rooms are closed in which system, and the history of every change." />} />
        <Route path="/hotels" element={<Hotels />} />
        <Route path="/hotels/:id" element={<HotelDetail />} />
        <Route path="/systems" element={<Systems />} />
        <Route path="/team" element={<Team />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
