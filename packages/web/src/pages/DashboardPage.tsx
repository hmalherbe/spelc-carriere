import { useEffect, useState } from "react";
import { api, type Campagne, type TeacherListItem } from "../api.js";

const BA_ESTIMATE_LABEL: Record<string, string> = {
  promu_estime: "Promu (estimé)",
  non_promu_estime: "Non promu (estimé)",
  indetermine: "Indéterminé",
};

const MATCHING_LABEL: Record<string, string> = {
  AUTO_CONFIRMED: "Adhérent (auto)",
  CONFIRMED: "Adhérent (confirmé)",
  PENDING_REVIEW: "À vérifier",
  REJECTED: "Non lié",
  NON_ADHERENT: "Non adhérent",
};

function euros(n: number): string {
  return `${n >= 0 ? "+" : ""}${n} €`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function DashboardPage() {
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .campagnes()
      .then((c) => {
        setCampagnes(c);
        if (c.length > 0) setCampagneId(c[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!campagneId) return;
    setLoading(true);
    api
      .teachers(campagneId)
      .then(setTeachers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [campagneId]);

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Enseignants promouvables</h2>
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

      {loading ? (
        <p>Chargement...</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Grade</th>
              <th>Échelon</th>
              <th>Prochaine promotion</th>
              <th>Gain net</th>
              <th>Adhérent</th>
              <th>Estimation BA</th>
              <th>Éligibilité HC / Exc.</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.teacherId}>
                <td>{t.nom}</td>
                <td>{t.prenom}</td>
                <td>{t.grade}</td>
                <td>
                  {t.echelonActuel} → {t.computedState?.echelonSuivant ?? "—"}
                </td>
                <td>{formatDate(t.computedState?.dateProchainePromotion ?? null)}</td>
                <td className={t.computedState && t.computedState.gainSalaireNet > 0 ? "gain-positive" : ""}>
                  {t.computedState ? euros(t.computedState.gainSalaireNet) : "—"}
                </td>
                <td>
                  <span className={`badge badge-${t.matching.status.toLowerCase()}`}>{MATCHING_LABEL[t.matching.status]}</span>
                </td>
                <td>
                  {t.baEstimate ? (
                    <span className={`badge badge-${t.baEstimate}`}>{BA_ESTIMATE_LABEL[t.baEstimate]}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {t.horsClasseEligible === null && t.classeExceptionnelleEligible === null ? (
                    "—"
                  ) : (
                    <div className="row-actions">
                      {t.horsClasseEligible !== null && (
                        <span className={`badge ${t.horsClasseEligible ? "badge-promu_estime" : "badge-indetermine"}`}>
                          HC {t.horsClasseEligible ? "éligible" : "non éligible"}
                        </span>
                      )}
                      {t.classeExceptionnelleEligible !== null && (
                        <span className={`badge ${t.classeExceptionnelleEligible ? "badge-promu_estime" : "badge-indetermine"}`}>
                          Exc. {t.classeExceptionnelleEligible ? "éligible" : "non éligible"}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
