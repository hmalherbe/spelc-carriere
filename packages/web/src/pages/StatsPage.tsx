import { useEffect, useState } from "react";
import { api, type Campagne, type CampagneStats } from "../api.js";

function GenreTable({ genre }: { genre: CampagneStats["ba"]["genre"] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th></th>
          <th>Hommes</th>
          <th>Femmes</th>
          <th>Indéterminé</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Nombre</td>
          <td>{genre.hommes.n}</td>
          <td>{genre.femmes.n}</td>
          <td>{genre.indetermine.n}</td>
        </tr>
        <tr>
          <td>Pourcentage</td>
          <td>{genre.hommes.pct}%</td>
          <td>{genre.femmes.pct}%</td>
          <td>{genre.indetermine.pct}%</td>
        </tr>
      </tbody>
    </table>
  );
}

export function StatsPage() {
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [stats, setStats] = useState<CampagneStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (c.length > 0) setCampagneId(c[0].id);
      else setLoading(false);
    });
  }, []);

  // Un changement de campagne repart d'un filtre "Tous les grades" — la liste de grades d'une
  // autre campagne peut ne plus contenir celui qui était sélectionné.
  useEffect(() => {
    setGradeFilter("all");
  }, [campagneId]);

  useEffect(() => {
    if (!campagneId) return;
    setLoading(true);
    setError(null);
    api
      .stats(campagneId, gradeFilter === "all" ? undefined : gradeFilter)
      .then(setStats)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [campagneId, gradeFilter]);

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Statistiques</h2>
        {campagnes.length > 0 && (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {campagnes.map((c) => (
              <option key={c.id} value={c.id}>
                Campagne {c.anneeScolaire}
              </option>
            ))}
          </select>
        )}
        {stats && stats.grades.length > 0 && (
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
            <option value="all">Tous les grades</option>
            {stats.grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="hint">
        La civilité d'un adhérent est déclarée ; celle d'un non-adhérent est estimée à partir de son prénom et peut
        être indéterminée — voir la page Mailing. Ces répartitions hommes/femmes en héritent donc la même marge
        d'incertitude.
      </p>

      {loading || !stats ? (
        <p>Chargement...</p>
      ) : (
        <>
          <section className="card">
            <h2>Bonification d'ancienneté (BA){gradeFilter !== "all" && ` — ${gradeFilter}`}</h2>
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="stat-value">{stats.ba.promus}</div>
                <div className="stat-label">BA promus</div>
              </div>
              <div className="stat-tile">
                <div className="stat-value">{stats.ba.nonPromus}</div>
                <div className="stat-label">BA non promus</div>
              </div>
              <div className="stat-tile">
                <div className="stat-value">{stats.ba.promouvables}</div>
                <div className="stat-label">Total promouvables</div>
              </div>
              <div className="stat-tile">
                <div className="stat-value">{stats.ba.pctPromus}%</div>
                <div className="stat-label">% BA promus / promouvables</div>
              </div>
            </div>
            {(stats.ba.national > 0 || stats.ba.horsFenetre > 0) && (
              <p className="hint">
                Hors calcul ci-dessus : {stats.ba.national} agrégé(s) candidat(s) BA (décision ministérielle, promu/non
                promu non déterminable ici)
                {stats.ba.horsFenetre > 0 && <>, {stats.ba.horsFenetre} anomalie(s) hors fenêtre d'éligibilité</>}.
              </p>
            )}

            <h3>Répartition hommes / femmes parmi les BA (promouvables)</h3>
            <GenreTable genre={stats.ba.genre} />
          </section>

          <section className="card">
            <h2>Tous les promus (campagne){gradeFilter !== "all" && ` — ${gradeFilter}`}</h2>
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="stat-value">{stats.tousLesPromus.total}</div>
                <div className="stat-label">Total promus, tous types confondus</div>
              </div>
            </div>

            <h3>Répartition hommes / femmes parmi tous les promus</h3>
            <GenreTable genre={stats.tousLesPromus.genre} />
          </section>
        </>
      )}
    </div>
  );
}
