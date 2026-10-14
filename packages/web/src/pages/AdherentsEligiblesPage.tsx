import { useEffect, useMemo, useState } from "react";
import { api, downloadBlob, type AdherentEligible } from "../api.js";
import { useCampagneSelection, labelForCampagneCandidate } from "../CampagneContext.js";
import { formatPrenom } from "../format.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

function commissionLabel(degre: 1 | 2 | null): string {
  if (degre === 2) return "CCMA";
  if (degre === 1) return "CCMI";
  return "—";
}

type PresenceFilter = "all" | "oui" | "non";

export function AdherentsEligiblesPage() {
  const { candidates: campagnes, campagneId, setCampagneId } = useCampagneSelection(["ECHELON"]);
  const [adherents, setAdherents] = useState<AdherentEligible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("all");
  const [exportingNonPresents, setExportingNonPresents] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!campagneId) {
      setAdherents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .adherentsEligibles(campagneId)
      .then(setAdherents)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [campagneId]);

  const visible = useMemo(() => {
    if (presenceFilter === "all") return adherents;
    const wantNonPresent = presenceFilter === "oui";
    return adherents.filter((a) => a.nonPresentDansRectorat === wantNonPresent);
  }, [adherents, presenceFilter]);

  const nonPresentCount = useMemo(() => adherents.filter((a) => a.nonPresentDansRectorat).length, [adherents]);

  async function exportNonPresents() {
    if (!campagneId) return;
    setExportingNonPresents(true);
    setExportError(null);
    try {
      const blob = await api.adherentsEligiblesNonPresentsXlsx(campagneId);
      downloadBlob(blob, "adherents_eligibles_non_presents_rectorat.xlsx");
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExportingNonPresents(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Adhérents éligibles à la CCMA/CCMI</h2>
        {campagnes.length > 1 && (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {campagnes.map((c) => (
              <option key={c.id} value={c.id}>
                {labelForCampagneCandidate(c, 1)}
              </option>
            ))}
          </select>
        )}
      </div>
      {campagnes.length === 0 && (
        <p className="hint">
          Aucune campagne d'avancement d'échelon (CCMA/CCMI) pour l'année scolaire sélectionnée — créez-la depuis la
          page Import, ou changez d'année scolaire dans l'en-tête.
        </p>
      )}
      <p className="hint">
        Adhérents dont la prochaine promotion d'échelon (date de dernier changement + durée de l'échelon) tombe dans
        la période de cette campagne — qu'ils soient déjà rapprochés d'un enseignant ou non.
      </p>
      {!loading && (
        <p className="hint">
          Non présents dans les fichiers du rectorat de cette campagne :{" "}
          <strong>
            {nonPresentCount} / {adherents.length}
          </strong>{" "}
          adhérents éligibles.
        </p>
      )}
      <div className="row-actions" style={{ marginBottom: 16 }}>
        <button type="button" className="secondary" onClick={exportNonPresents} disabled={!campagneId || exportingNonPresents}>
          {exportingNonPresents ? "Export en cours..." : "Adhérents éligibles non présents dans fichiers rectorats"}
        </button>
        {exportError && <span className="error-text">{exportError}</span>}
      </div>
      {loading ? (
        <p>Chargement...</p>
      ) : visible.length === 0 ? (
        <p className="hint">Aucun adhérent éligible pour cette campagne (avec ce filtre).</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Grade</th>
              <th>Commission</th>
              <th>Prochaine promotion</th>
              <th>
                Non présent dans les fichiers du rectorat
                <br />
                <select
                  value={presenceFilter}
                  onChange={(e) => setPresenceFilter(e.target.value as PresenceFilter)}
                  style={{ marginTop: 4, fontWeight: "normal", textTransform: "none" }}
                >
                  <option value="all">Tous</option>
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.adherentId}>
                <td>{a.nom}</td>
                <td>{formatPrenom(a.prenom)}</td>
                <td>{a.grade ?? "—"}</td>
                <td>{commissionLabel(a.degre)}</td>
                <td>{formatDate(a.dateProchainePromotion)}</td>
                <td>
                  {a.nonPresentDansRectorat ? (
                    <span className="badge badge-non_promu_estime">Oui</span>
                  ) : (
                    <span className="badge badge-promu_estime">Non</span>
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
