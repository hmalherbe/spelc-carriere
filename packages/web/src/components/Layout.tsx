import { useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext.js";
import { useCampagneContext } from "../CampagneContext.js";
import { api } from "../api.js";
import { derivePeriodeFromAnneeScolaire } from "../format.js";

// Level 3 of the tree, in practice: everything already built under "Suivi de la carrière >
// Avancement" (échelon CCMA/CCMI). Kept as a flat list of paths so both the "Avancement" dropdown
// entry and the contextual sub-nav below know when they're in this section.
const AVANCEMENT_PATHS = [
  "/",
  "/revue",
  "/adherents-eligibles",
  "/import",
  "/mailing",
  "/elus",
  "/reliquats",
  "/regles",
  "/grilles",
  "/statistiques",
];

type AnneeScolaireDraft = { anneeScolaire: string; periodeDebut: string; periodeFin: string };
const EMPTY_DRAFT: AnneeScolaireDraft = { anneeScolaire: "", periodeDebut: "", periodeFin: "" };

/**
 * Sélecteur global d'année scolaire (voir l'étude de faisabilité "année scolaire comme entité de
 * premier niveau", 2026-10-15) — pilote le contexte (CampagneContext) dont dérivent toutes les
 * pages d'avancement/adhérents (Dashboard, Revue, Adhérents éligibles, Import, Mailing, Reliquats,
 * Statistiques, Hors classe/Classe exceptionnelle), chacune filtrant à son tour sur la nature qui la
 * concerne. Le compteur "X/6" à côté de chaque année montre d'un coup d'œil quelles années scolaires
 * restent incomplètes (ex. seules les CCMA/CCMI d'échelon existent, pas encore HC/EXC).
 */
function AnneeScolairePicker() {
  const { user } = useAuth();
  const canCreate = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";
  const { campagnes, anneesScolaires, selectedAnneeScolaire, setSelectedAnneeScolaire, refresh } = useCampagneContext();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draft, setDraft] = useState<AnneeScolaireDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const countByAnnee = new Map<string, number>();
  for (const c of campagnes) countByAnnee.set(c.anneeScolaire, (countByAnnee.get(c.anneeScolaire) ?? 0) + 1);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const { created } = await api.createAnneeScolaire(draft);
      await refresh();
      setSelectedAnneeScolaire(draft.anneeScolaire);
      setShowCreateForm(false);
      setDraft(EMPTY_DRAFT);
      if (created.length === 0) {
        setCreateError(`"${draft.anneeScolaire}" existait déjà en entier (6/6) — rien de nouveau créé.`);
      }
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="annee-scolaire-picker">
      {anneesScolaires.length > 0 && (
        <select
          aria-label="Année scolaire"
          value={selectedAnneeScolaire ?? ""}
          onChange={(e) => setSelectedAnneeScolaire(e.target.value)}
        >
          {anneesScolaires.map((a) => (
            <option key={a} value={a}>
              {a} ({countByAnnee.get(a) ?? 0}/6)
            </option>
          ))}
        </select>
      )}
      {canCreate && (
        <button type="button" className="annee-scolaire-create-button" onClick={() => setShowCreateForm((s) => !s)}>
          + Année scolaire
        </button>
      )}
      {showCreateForm && (
        <form className="annee-scolaire-form-panel" onSubmit={submitCreate}>
          <label>
            Année scolaire
            <input
              required
              placeholder="2026-2027"
              value={draft.anneeScolaire}
              onChange={(e) => {
                const anneeScolaire = e.target.value;
                const derived = derivePeriodeFromAnneeScolaire(anneeScolaire);
                setDraft((s) => ({ ...s, anneeScolaire, ...(derived ?? {}) }));
              }}
            />
          </label>
          <label>
            Début de période
            <input required type="date" value={draft.periodeDebut} onChange={(e) => setDraft((s) => ({ ...s, periodeDebut: e.target.value }))} />
          </label>
          <label>
            Fin de période
            <input required type="date" value={draft.periodeFin} onChange={(e) => setDraft((s) => ({ ...s, periodeFin: e.target.value }))} />
          </label>
          <p className="hint">
            Crée les 6 campagnes de cette année (CCMA/CCMI échelon, HC, EXC) — chaque commission ayant sa propre date de
            réunion, à renseigner ensuite individuellement depuis Import / Hors classe-Classe exceptionnelle une fois
            connue. Sans effet sur les campagnes déjà créées pour cette année scolaire.
          </p>
          <button type="submit" disabled={creating}>
            {creating ? "Création..." : "Créer"}
          </button>
          {createError && <p className="error-text">{createError}</p>}
        </form>
      )}
    </div>
  );
}

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
        <AnneeScolairePicker />
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
          <NavLink to="/assistant-ia">Assistant IA</NavLink>
          <NavLink to="/parametres">Paramètres</NavLink>
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
          <NavLink to="/adherents-eligibles">Adhérents éligibles</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/mailing">Mailing</NavLink>
          <NavLink to="/elus">Élus CCMA/CCMI</NavLink>
          <NavLink to="/reliquats">Reliquats</NavLink>
          <NavLink to="/regles">Règles de gestion</NavLink>
          <NavLink to="/grilles">Grilles indiciaires</NavLink>
          <NavLink to="/statistiques">Statistiques</NavLink>
        </nav>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
