import { useEffect, useState } from "react";
import { api, type Campagne, type MatchCandidate } from "../api.js";
import { useAuth } from "../AuthContext.js";

export function ReviewQueuePage() {
  const { user } = useAuth();
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canReview = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  useEffect(() => {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (c.length > 0) setCampagneId(c[0].id);
      else setLoading(false);
    });
  }, []);

  function refresh(id: string) {
    setLoading(true);
    api
      .pendingMatches(id)
      .then(setCandidates)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (campagneId) refresh(campagneId);
  }, [campagneId]);

  async function confirm(id: string, teacherId: string | null) {
    if (!teacherId || !campagneId) return;
    await api.confirmMatch(id, teacherId);
    refresh(campagneId);
  }

  async function reject(id: string) {
    if (!campagneId) return;
    await api.rejectMatch(id);
    refresh(campagneId);
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>File de révision des rapprochements adhérents ↔ enseignants</h2>
        {campagnes.length > 0 && (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {campagnes.map((c) => (
              <option key={c.id} value={c.id}>
                Campagne {c.anneeScolaire}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="hint">
        Limité aux adhérents éligibles à la CCMA/CCMI pour cette campagne (prochaine promotion d'échelon prévue dans sa
        période). Une fois confirmé ou rejeté ici, un lien reste permanent — seuls les nouveaux cas ambigus reviennent
        dans cette file lors des prochains imports.
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
