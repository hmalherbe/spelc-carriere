import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext.js";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Spelc</h1>
        <nav>
          <NavLink to="/" end>
            Enseignants
          </NavLink>
          <NavLink to="/revue">File de révision</NavLink>
          <NavLink to="/seuils-ba">Seuils BA</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/mailing">Mailing</NavLink>
        </nav>
        <div className="user-badge">
          <span>
            {user?.name} <em>({user?.role})</em>
          </span>
          <button onClick={logout}>Déconnexion</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
