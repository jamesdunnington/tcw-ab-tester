import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.js";
import { LoginPage } from "./pages/Login.js";
import { SitesPage } from "./pages/Sites.js";
import { TestsPage } from "./pages/Tests.js";
import { TestDetailPage } from "./pages/TestDetail.js";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="center-loading">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      {user && (
        <header className="topbar">
          <strong>TCW A/B Tester</strong>
          <span>
            {user.email} · <button className="link-button" onClick={() => logout()}>Log out</button>
          </span>
        </header>
      )}
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sites" element={<RequireAuth><SitesPage /></RequireAuth>} />
          <Route path="/sites/:siteId/tests" element={<RequireAuth><TestsPage /></RequireAuth>} />
          <Route path="/tests/:testId" element={<RequireAuth><TestDetailPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/sites" replace />} />
        </Routes>
      </main>
    </div>
  );
}
