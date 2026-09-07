import { useEffect, useState } from "react";
import { api, type MatchCandidate } from "../api.js";
import { useAuth } from "../AuthContext.js";

export function ReviewQueuePage() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canReview = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  function refresh() {
    setLoading(true);
    api
      .pendingMatches()
      .then(setCandidates)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function confirm(id: string, teacherId: string | null) {
    if (!teacherId) return;
    await api.confirmMatch(id, teacherId);
    refresh();
  }

  async function reject(id: string) {
    await api.rejectMatch(id);
    refresh();
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <h2>File de révision des rapprochements adhérents ↔ enseignants</h2>
      <p className="hint">
        Une fois confirmé ou rejeté ici, un lien reste permanent — seuls les nouveaux cas ambigus reviennent dans cette file lors des
        prochains imports.
      </p>
      {loading ? (
        <p>Chargement...</p>
      ) : candidates.length === 0 ? (
        <p>Aucun cas en attente de révision.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Adhérent (fichier Spelc)</th>
              <th>Enseignant suggéré (fichier rectorat)</th>
              <th>Confiance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const suggestion = c.teacher?.snapshots[0];
              return (
                <tr key={c.id}>
                  <td>
                    {c.adherent.nom} {c.adherent.prenom}
                    <br />
                    <span className="hint">{c.adherent.grade ?? "—"}</span>
                  </td>
                  <td>
                    {suggestion ? (
                      <>
                        {suggestion.nomUsage} {suggestion.prenom}
                        <br />
                        <span className="hint">{suggestion.grade}</span>
                      </>
                    ) : (
                      <em>Aucune correspondance trouvée</em>
                    )}
                  </td>
                  <td>{(c.confidence * 100).toFixed(0)}%</td>
                  <td>
                    {canReview ? (
                      <div className="row-actions">
                        <button disabled={!c.teacherId} onClick={() => confirm(c.id, c.teacherId)}>
                          Confirmer
                        </button>
                        <button className="secondary" onClick={() => reject(c.id)}>
                          Rejeter
                        </button>
                      </div>
                    ) : (
                      <span className="hint">Lecture seule</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
