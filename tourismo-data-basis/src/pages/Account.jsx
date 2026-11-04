import { useAuth } from '../auth.jsx';
import { roleLabel } from '../labels.js';
import { PasswordForm } from './ChangePassword.jsx';

export default function Account() {
  const { profile } = useAuth();
  return (
    <div className="page narrow">
      <h1>My account</h1>
      <div className="card">
        <dl className="details">
          <dt>Name</dt><dd>{profile.full_name || '—'}</dd>
          <dt>Email</dt><dd>{profile.email}</dd>
          <dt>Role</dt><dd>{roleLabel(profile.role)}</dd>
          <dt>Can open “!!!!!” (no prices)</dt>
          <dd>{profile.can_open_no_prices || ['manager', 'admin'].includes(profile.role) ? 'Yes' : 'No'}</dd>
        </dl>
        <p className="hint">To change your name or role, ask the platform admin.</p>
      </div>
      <div className="card">
        <h2>Change password</h2>
        <PasswordForm />
      </div>
    </div>
  );
}
