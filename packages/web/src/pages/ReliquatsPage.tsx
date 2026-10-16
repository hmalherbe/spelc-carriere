import { useEffect, useState } from "react";
import { api, type ReliquatCandidate, type ReliquatGroup } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { useCampagneSelection } from "../CampagneContext.js";
import { formatPrenom } from "../format.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

function formatAnciennete(annees: number | null): string {
  if (annees == null) return "—";
  return `${annees.toFixed(2)} an(s)`;
}

export function ReliquatsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const { candidates: campagnes, campagneId } = useCampagneSelection(["ECHELON"]);
  const [groups, setGroups] = useState<ReliquatGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function refresh(id: string) {
    setLoading(true);
    setError(null);
    api
      .reliquatCandidates(id)
      .then((r) => setGroups(r.groups))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (campagneId) refresh(campagneId);
    else {
      setGroups([]);
      setLoading(false);
    }
  }, [campagneId]);

  async function toggle(candidate: ReliquatCandidate) {
    if (!campagneId) return;
    setTogglingId(candidate.teacherId);
    setError(null);
    try {
      if (candidate.selected) await api.unselectReliquat(campagneId, candidate.teacherId);
      else await api.selectReliquat(campagneId, candidate.teacherId);
      refresh(campagneId);
    } catch (e) {
      setError(String(e));
    } finally {
      setTogglingId(null);
    }
  }

  if (error && groups.length === 0) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Reliquats — bonification d'ancienneté</h2>
      </div>
      {campagnes.length === 0 && (
        <p className="hint">
          Aucune campagne d'avancement d'échelon (CCMA/CCMI) pour l'année scolaire sélectionnée — créez-la depuis la page
          Import, ou changez d'année scolaire dans l'en-tête.
        </p>
      )}
      <p className="hint">
        Une promotion à la bonification d'ancienneté (BA) accordée après coup, sur reliquat (arrondis du quota de
        30 % de promouvables) — le fichier rectorat ne porte jamais de marqueur "Pro BA." pour ce cas. Cocher ici un
        enseignant parmi ceux que le fichier rectorat seul laisse "non promu" (échelon 6 ou 8) le fait apparaître
        "Promu BA" sur les pages Enseignants et Mailing, et dans le mail envoyé.
      </p>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p>Chargement...</p>
      ) : groups.length === 0 ? (
        <p className="hint">Aucun candidat BA "non promu" (échelon 6 ou 8) pour cette campagne.</p>
      ) : (
        groups.map((g) => (
          <section className="card" key={`${g.grade}|${g.echelon}|${g.departement ?? ""}`}>
            <h3>
              {g.grade} — échelon {g.echelon}
              {g.departement && ` — ${g.departement}`}
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  {canEdit && <th></th>}
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Barème</th>
                  <th>Ancienneté grade</th>
                  <th>Ancienneté échelon</th>
                  <th>Éligible BA depuis le</th>
                </tr>
              </thead>
              <tbody>
                {g.candidates.map((c) => (
                  <tr key={c.teacherId}>
                    {canEdit && (
                      <td>
                        <input
                          type="checkbox"
                          checked={c.selected}
                          disabled={togglingId === c.teacherId}
                          onChange={() => toggle(c)}
                          title="Promu via reliquat"
                        />
                      </td>
                    )}
                    <td>{c.nom}</td>
                    <td>{formatPrenom(c.prenom)}</td>
                    <td>{c.bareme ?? "—"}</td>
                    <td>{formatAnciennete(c.ancienneteGrade)}</td>
                    <td>{formatAnciennete(c.ancienneteEchelon)}</td>
                    <td>{formatDate(c.dateEligibiliteBA)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
