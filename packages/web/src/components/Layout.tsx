import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext.js";

// Level 3 of the tree, in practice: everything already built under "Suivi de la carrière >
// Avancement" (échelon CCMA/CCMI). Kept as a flat list of paths so both the "Avancement" dropdown
// entry and the contextual sub-nav below know when they're in this section.
const AVANCEMENT_PATHS = ["/", "/revue", "/seuils-ba", "/import", "/mailing", "/regles", "/grilles"];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const inAvancement = AVANCEMENT_PATHS.includes(location.pathname);
  const inCarriere =
    inAvancement || location.pathname === "/hors-classe-exceptionnelle" || location.pathname === "/reclassement";

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Spelc Côte d'Azur</h1>
        <nav>
          <div className="nav-group">
            <button type="button" className={`nav-group-label${inCarriere ? " active" : ""}`}>
              Suivi de la carrière
            </button>
            <div className="nav-dropdown">
              <Link to="/" className={inAvancement ? "active" : undefined}>
                Avancement (échelon)
              </Link>
              <NavLink to="/hors-classe-exceptionnelle">Hors classe / Classe exceptionnelle</NavLink>
              <NavLink to="/reclassement">Reclassement</NavLink>
            </div>
          </div>
          <NavLink to="/mouvement">Mouvement des enseignants</NavLink>
        </nav>
        <div className="user-badge">
          <span>
            {user?.name} <em>({user?.role})</em>
          </span>
          <button onClick={logout}>Déconnexion</button>
        </div>
      </header>
      {inAvancement && (
        <nav className="app-subnav">
          <NavLink to="/" end>
            Enseignants
          </NavLink>
          <NavLink to="/revue">File de révision</NavLink>
          <NavLink to="/seuils-ba">Seuils BA</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/mailing">Mailing</NavLink>
          <NavLink to="/regles">Règles de gestion</NavLink>
          <NavLink to="/grilles">Grilles indiciaires</NavLink>
        </nav>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
