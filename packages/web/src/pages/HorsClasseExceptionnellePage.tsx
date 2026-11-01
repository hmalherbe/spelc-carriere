import { useEffect, useState } from "react";
import { api, type Campagne, type HcExcGroupe, type HcExcTeacherRow } from "../api.js";
import { formatPrenom } from "../format.js";
import { HcExcCampagneCard } from "../components/HcExcCampagneCard.js";

/** "Enseignants promouvables" — liste des résultats d'une campagne HC/EXC déjà importée (voir
 * HcExcImportPage.tsx pour l'import lui-même, désormais un onglet séparé). */
export function HorsClasseExceptionnellePage() {
  const [selectedCampagne, setSelectedCampagne] = useState<Campagne | null>(null);
  const campagneId = selectedCampagne?.id ?? null;

  const [rows, setRows] = useState<HcExcTeacherRow[]>([]);
  const [groupes, setGroupes] = useState<HcExcGroupe[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  useEffect(() => {
    if (!campagneId) {
      setRows([]);
      setGroupes([]);
      return;
    }
    setResultsLoading(true);
    api
      .hcExcTeachers(campagneId)
      .then((r) => {
        setRows(r.rows);
        setGroupes(r.groupes);
      })
      .finally(() => setResultsLoading(false));
  }, [campagneId]);

  return (
    <div className="import-page">
      <HcExcCampagneCard canEdit={false} onSelect={setSelectedCampagne} />

      {selectedCampagne && groupes.length > 0 && (
        <section className="card">
          <h2>Promotions par grade</h2>
          <p className="hint">
            Calculé automatiquement à partir de la décision de chaque fiche (voir la colonne "Promu" ci-dessous, modifiable
            depuis l'onglet Mailing) — plus de contingent à saisir à la main.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Vivier</th>
                <th>Promus</th>
                <th>Dernier promu (rang)</th>
                <th>Dernier promu (barème)</th>
              </tr>
            </thead>
            <tbody>
              {groupes.map((g) => (
                <tr key={`${g.grade}|${g.vivier ?? ""}`}>
                  <td>{g.grade}</td>
                  <td>{g.vivier ?? "—"}</td>
                  <td>{g.nombrePromus}</td>
                  <td>{g.rangDernierPromu ?? "—"}</td>
                  <td>{g.totalBaremeDernierPromu ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selectedCampagne && (
        <section className="card">
          <h2>Résultats</h2>
          {resultsLoading ? (
            <p>Chargement...</p>
          ) : rows.length === 0 ? (
            <p className="hint">Aucune fiche importée pour cette campagne.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Grade</th>
                  <th>Vivier</th>
                  <th>Barème</th>
                  <th>Choix recteur</th>
                  <th>Promu</th>
                  <th>Adhérent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.rang}</td>
                    <td>{r.nomUsage}</td>
                    <td>{formatPrenom(r.prenom)}</td>
                    <td>{r.grade}</td>
                    <td>{r.vivier ?? "—"}</td>
                    <td>{r.totalBareme ?? "—"}</td>
                    <td>{r.choixRecteur ? "Oui" : "—"}</td>
                    <td>
                      <span className={`badge ${r.promu ? "badge-promu_estime" : "badge-non_promu_estime"}`}>
                        {r.promu ? "Promu" : "Non promu"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.isAdherent ? "badge-auto_confirmed" : "badge-non_adherent"}`}>
                        {r.isAdherent ? "Adhérent" : "Non adhérent"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
