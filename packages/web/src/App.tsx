import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ReviewQueuePage } from "./pages/ReviewQueuePage.js";
import { BaSeuilsPage } from "./pages/BaSeuilsPage.js";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="hint">Chargement...</p>;
  if (!user) return <Navigate to="/connexion" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="revue" element={<ReviewQueuePage />} />
        <Route path="seuils-ba" element={<BaSeuilsPage />} />
      </Route>
    </Routes>
  );
}
