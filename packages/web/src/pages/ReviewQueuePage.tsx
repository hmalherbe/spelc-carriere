import { useEffect, useState } from "react";
import { api, type MatchCandidate } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { formatPrenom } from "../format.js";

export function ReviewQueuePage() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
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

  useEffect(() => {
    refresh();
  }, []);

  async function confirm(id: string, teacherId: string | null) {
    if (!teacherId) return;
    await api.confirmMatch(id, teacherId);
    refresh();
  }

  async function reject(id: string) {
    await api.rejectMatch(id);
    refresh();
  }

  async function rescan() {
    setRescanning(true);
    try {
      await api.rescanMatches();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRescanning(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>File de révision des rapprochements adhérents ↔ enseignants</h2>
        {canReview && (
          <button className="secondary" onClick={rescan} disabled={rescanning}>
            {rescanning ? "Recalcul..." : "Recalculer les rapprochements"}
          </button>
        )}
      </div>
      <p className="hint">
        Tous les rapprochements en attente, toutes campagnes confondues — pour la liste des adhérents dus pour une
        campagne précise, voir l'onglet « Adhérents éligibles ». Une fois confirmé ou rejeté ici, un lien reste
        permanent — seuls les nouveaux cas ambigus reviennent dans cette file lors des prochains imports. Le bouton
        « Recalculer les rapprochements » relance immédiatement cette recherche pour tous les cas en attente, sans
        attendre le prochain import.
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
              // "Rien à confirmer" covers two different states that must both disable Confirmer:
              // no teacherId at all (never matched), or a teacherId whose teacher has since lost
              // every snapshot (a corrected rectorat re-import wholesale-replaced their fiches and
              // the new file no longer lists them) — that teacherId is stale, not a real
              // suggestion, even though it's still technically set on this row.
              const nothingToConfirm = !c.teacherId || !suggestion;
              return (
                <tr key={c.id}>
                  <td>
                    {c.adherent.nom} {formatPrenom(c.adherent.prenom)}
                    <br />
                    <span className="hint">{c.adherent.grade ?? "—"}</span>
                  </td>
                  <td>
                    {suggestion ? (
                      <>
                        {suggestion.nomUsage} {formatPrenom(suggestion.prenom)}
                        <br />
                        <span className="hint">{suggestion.grade}</span>
                      </>
                    ) : c.teacherId ? (
                      <em>Enseignant introuvable (fiche supprimée depuis la suggestion)</em>
                    ) : (
                      <em>Aucune correspondance trouvée</em>
                    )}
                  </td>
                  <td>{(c.confidence * 100).toFixed(0)}%</td>
                  <td>
                    {canReview ? (
                      <div className="row-actions">
                        <button disabled={nothingToConfirm} onClick={() => confirm(c.id, c.teacherId)}>
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
