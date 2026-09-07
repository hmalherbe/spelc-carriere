import { useEffect, useMemo, useState } from "react";
import { api, type Campagne, type TeacherListItem } from "../api.js";

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

/** Has SOME link to an adhérent record, confirmed or not — used by the adhérent/non-adhérent filter. */
function isLinkedToAdherent(t: TeacherListItem): boolean {
  return t.matching.status === "AUTO_CONFIRMED" || t.matching.status === "CONFIRMED" || t.matching.status === "PENDING_REVIEW";
}

/** Numeric-aware échelon ordering — échelon is a free-form string ("06", "6", "A1"...); lettered
 * échelons (hors-classe/classe exceptionnelle) sort after every numeric one. */
function echelonSortValue(echelon: string): number {
  const n = Number(echelon);
  return Number.isFinite(n) ? n : 1000 + echelon.charCodeAt(0);
}

function baCell(t: TeacherListItem): { label: string; className: string } {
  if (t.baEligible === null) return { label: "—", className: "" };
  if (!t.baEligible) return { label: "Non éligible", className: "badge badge-indetermine" };
  if (t.baEstimate === "promu_estime") return { label: "Éligible — promu (estimé)", className: "badge badge-promu_estime" };
  if (t.baEstimate === "non_promu_estime") return { label: "Éligible — non promu (estimé)", className: "badge badge-non_promu_estime" };
  return { label: "Éligible", className: "badge badge-indetermine" };
}

type SortKey = "nom" | "grade" | "echelon";
type AdherentFilter = "all" | "adherent" | "non_adherent";
type BaFilter = "all" | "eligible" | "non_eligible";

export function DashboardPage() {
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adherentFilter, setAdherentFilter] = useState<AdherentFilter>("all");
  const [baFilter, setBaFilter] = useState<BaFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [echelonFilter, setEchelonFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("nom");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  const grades = useMemo(() => Array.from(new Set(teachers.map((t) => t.grade))).sort(), [teachers]);
  const echelons = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.echelonActuel))).sort((a, b) => echelonSortValue(a) - echelonSortValue(b)),
    [teachers],
  );

  const visibleTeachers = useMemo(() => {
    const filtered = teachers.filter((t) => {
      if (adherentFilter === "adherent" && !isLinkedToAdherent(t)) return false;
      if (adherentFilter === "non_adherent" && isLinkedToAdherent(t)) return false;
      if (baFilter === "eligible" && t.baEligible !== true) return false;
      if (baFilter === "non_eligible" && t.baEligible !== false) return false;
      if (gradeFilter !== "all" && t.grade !== gradeFilter) return false;
      if (echelonFilter !== "all" && t.echelonActuel !== echelonFilter) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortKey === "nom") {
        cmp = a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom);
      } else if (sortKey === "grade") {
        // "trier sur grade puis échelon" — grade first, échelon as the tie-break within it.
        cmp = a.grade.localeCompare(b.grade) || echelonSortValue(a.echelonActuel) - echelonSortValue(b.echelonActuel);
      } else {
        cmp = echelonSortValue(a.echelonActuel) - echelonSortValue(b.echelonActuel);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [teachers, adherentFilter, baFilter, gradeFilter, echelonFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

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

      <div className="inline-form">
        <label>
          Adhérent
          <select value={adherentFilter} onChange={(e) => setAdherentFilter(e.target.value as AdherentFilter)}>
            <option value="all">Tous</option>
            <option value="adherent">Adhérent</option>
            <option value="non_adherent">Non adhérent</option>
          </select>
        </label>
        <label>
          Éligibilité BA
          <select value={baFilter} onChange={(e) => setBaFilter(e.target.value as BaFilter)}>
            <option value="all">Tous</option>
            <option value="eligible">Éligible BA</option>
            <option value="non_eligible">Non éligible BA</option>
          </select>
        </label>
        <label>
          Grade
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
            <option value="all">Tous</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon
          <select value={echelonFilter} onChange={(e) => setEchelonFilter(e.target.value)}>
            <option value="all">Tous</option>
            {echelons.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p>Chargement...</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("nom")}>
                Nom{sortIndicator("nom")}
              </th>
              <th>Prénom</th>
              <th className="sortable" onClick={() => toggleSort("grade")}>
                Grade{sortIndicator("grade")}
              </th>
              <th className="sortable" onClick={() => toggleSort("echelon")}>
                Échelon{sortIndicator("echelon")}
              </th>
              <th>Date échelon actuel</th>
              <th>Prochaine promotion</th>
              <th>Gain net</th>
              <th>Adhérent</th>
              <th>Éligibilité BA</th>
              <th>Éligibilité HC / Exc.</th>
            </tr>
          </thead>
          <tbody>
            {visibleTeachers.map((t) => {
              const ba = baCell(t);
              return (
                <tr key={t.teacherId}>
                  <td>{t.nom}</td>
                  <td>{t.prenom}</td>
                  <td>{t.grade}</td>
                  <td>
                    {t.echelonActuel} → {t.computedState?.echelonSuivant ?? "—"}
                  </td>
                  <td>{formatDate(t.dateAccesEchelon)}</td>
                  <td>{formatDate(t.computedState?.dateProchainePromotion ?? null)}</td>
                  <td className={t.computedState && t.computedState.gainSalaireNet > 0 ? "gain-positive" : ""}>
                    {t.computedState ? euros(t.computedState.gainSalaireNet) : "—"}
                  </td>
                  <td>
                    <span className={`badge badge-${t.matching.status.toLowerCase()}`}>{MATCHING_LABEL[t.matching.status]}</span>
                  </td>
                  <td>{ba.className ? <span className={ba.className}>{ba.label}</span> : ba.label}</td>
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
