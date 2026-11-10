import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { initials } from '../format';
import { DocIcon } from './icons';

export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return <span className={`avatar${small ? ' avatar-sm' : ''}`} title={name}>{initials(name)}</span>;
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="user-menu">
      <Avatar name={user.name} />
      <div className="user-meta">
        <span className="user-name">{user.name}</span>
        <button
          type="button"
          className="link-btn"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Switch user
        </button>
      </div>
    </div>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        <span className="brand-mark"><DocIcon /></span>
        Ajaia Docs
      </Link>
      <div className="header-spacer">{children}</div>
      <UserMenu />
    </header>
  );
}
