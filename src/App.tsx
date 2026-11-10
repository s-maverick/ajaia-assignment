import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { lazy, Suspense, type ReactNode } from 'react';

// The editor (TipTap/ProseMirror) is the heaviest part of the bundle; load it on demand.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-screen muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route
        path="/d/:id"
        element={
          <RequireAuth>
            <Suspense fallback={<div className="center-screen muted">Loading editor…</div>}>
              <EditorPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
