import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/AppHeader';
import { DocIcon } from '../components/icons';
import type { User } from '../types';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.demoUsers().then(({ users }) => setUsers(users)).catch((err) => setError(err.message));
  }, []);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={redirectTo} replace />;

  const signIn = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(address);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void signIn(email.trim());
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark"><DocIcon /></span>
          Ajaia Docs
        </div>
        <p className="muted">Pick a demo account to sign in. Use two different browsers (or a private window) to try sharing between users.</p>

        <div className="account-list">
          {users.map((u) => (
            <button key={u.id} type="button" className="account-btn" disabled={busy} onClick={() => signIn(u.email)}>
              <Avatar name={u.name} />
              <span className="person"><span>{u.name}</span><span className="muted">{u.email}</span></span>
            </button>
          ))}
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <input type="email" placeholder="or type a demo email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <button type="submit" className="btn" disabled={busy || !email.trim()}>Sign in</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="hint">Authentication is mocked for this prototype: no passwords.</p>
      </div>
    </div>
  );
}
