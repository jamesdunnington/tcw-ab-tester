import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.js";
import { LoginPage } from "./pages/Login.js";
import { SitesPage } from "./pages/Sites.js";
import { TestsPage } from "./pages/Tests.js";
import { TestDetailPage } from "./pages/TestDetail.js";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="empty" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  const { user, logout } = useAuth();

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      {user && (
        <header className="topbar">
          <span className="brand">TCW A/B Tester</span>
          <nav aria-label="Account" className="small">
            <span className="muted">{user.email}</span>{" "}
            <button className="link-button" onClick={() => logout()}>Log out</button>
          </nav>
        </header>
      )}
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sites" element={<RequireAuth><SitesPage /></RequireAuth>} />
          <Route path="/sites/:siteId/tests" element={<RequireAuth><TestsPage /></RequireAuth>} />
          <Route path="/tests/:testId" element={<RequireAuth><TestDetailPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/sites" replace />} />
        </Routes>
      </main>
    </>
  );
}
