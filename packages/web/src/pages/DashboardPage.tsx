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

function formatAnciennete(annees: number | null): string {
  if (annees == null) return "—";
  return `${annees.toFixed(2)} an(s)`;
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

/** Strips a leading zero for display ("07" -> "7") — échelon is zero-padded as stored/filtered on,
 * but reads oddly in a dropdown ("07" looks like a different value from "7"). Lettered échelons
 * (hors-classe/classe exceptionnelle codes like "A1") pass through unchanged. */
function formatEchelonLabel(echelon: string): string {
  const n = Number(echelon);
  return Number.isFinite(n) ? String(n) : echelon;
}

// La règle BA parle d'échelon 6 ou 8 (rendez-vous de carrière durant la 2e année du 6e échelon /
// entre le 18e et le 30e mois du 8e) — un échelon de DÉPART, alors que la colonne "Échelon" du
// tableau affiche l'échelon d'ARRIVÉE tel que titré par le rectorat (07/09 pour un cas BA). On le
// précise ici explicitement pour ne pas laisser le lecteur rapprocher la BA du mauvais échelon.
function baCell(t: TeacherListItem): { label: string; className: string } {
  // Gated on baStatus, PAS sur baEligible : un enseignant sans marqueur "BA." (suivi sur un autre
  // mécanisme AN/CL/RE ce tour-ci, ou hors-classe/classe-exceptionnelle) n'a simplement rien à voir
  // avec la BA — lui afficher "Non éligible" serait un faux signal sans rapport avec sa situation
  // réelle, même si son échelon/ancienneté ne serait de toute façon pas dans la fenêtre BA.
  if (t.baStatus === null) return { label: "—", className: "" };
  // "départ éch. X", pas juste "éch. X" : c'est l'échelon DEPUIS lequel la bonification s'applique
  // (6 ou 8), pas l'échelon affiché dans la colonne Échelon — qui montre l'échelon actuel/d'arrivée
  // (7 ou 9 une fois la promotion confirmée). Les deux peuvent légitimement diverger dans la même
  // ligne (ex. "Promu BA (départ éch. 8)" à côté d'une colonne Échelon affichant "9 → 10" : elle
  // est passée de 8 à 9 via la bonification, la colonne Échelon montre où elle en est maintenant).
  const dep = t.baEchelonDepart != null ? ` (départ éch. ${t.baEchelonDepart})` : "";
  // Candidat BA (marqueur présent) mais hors de la fenêtre d'ancienneté officielle — anomalie à
  // vérifier (cas réel observé : un marqueur "BA." sur ce qui était en fait un cycle AN classique).
  if (t.baStatus === "hors_fenetre") return { label: `BA hors fenêtre d'éligibilité${dep}`, className: "badge badge-indetermine" };
  // Agrégés : la promotion BA se décide au niveau national, pas dans ce fichier départemental —
  // on ne peut donc jamais dire "promu"/"non promu" de manière fiable pour eux (voir teachers.ts).
  if (t.baStatus === "national") return { label: `BA${dep}`, className: "badge badge-indetermine" };
  // Pour tout autre grade, le marqueur "Pro" du rectorat tranche directement, sans estimation.
  if (t.baStatus === "promu") return { label: `Promu BA${dep}`, className: "badge badge-promu_estime" };
  return { label: `Éligible à la BA - non promu${dep}`, className: "badge badge-non_promu_estime" };
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
  const [ancienneteMin, setAncienneteMin] = useState<string>("");
  const [ancienneteMax, setAncienneteMax] = useState<string>("");
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

  const selectedCampagne = useMemo(() => campagnes.find((c) => c.id === campagneId) ?? null, [campagnes, campagneId]);

  const grades = useMemo(() => Array.from(new Set(teachers.map((t) => t.grade))).sort(), [teachers]);
  const echelons = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.echelonActuel))).sort((a, b) => echelonSortValue(a) - echelonSortValue(b)),
    [teachers],
  );

  const visibleTeachers = useMemo(() => {
    const min = ancienneteMin === "" ? null : Number(ancienneteMin);
    const max = ancienneteMax === "" ? null : Number(ancienneteMax);
    const filtered = teachers.filter((t) => {
      if (adherentFilter === "adherent" && !isLinkedToAdherent(t)) return false;
      if (adherentFilter === "non_adherent" && isLinkedToAdherent(t)) return false;
      if (baFilter === "eligible" && t.baEligible !== true) return false;
      if (baFilter === "non_eligible" && t.baEligible !== false) return false;
      if (gradeFilter !== "all" && t.grade !== gradeFilter) return false;
      if (echelonFilter !== "all" && t.echelonActuel !== echelonFilter) return false;
      if (min !== null && (t.ancienneteEchelon == null || t.ancienneteEchelon < min)) return false;
      if (max !== null && (t.ancienneteEchelon == null || t.ancienneteEchelon > max)) return false;
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
  }, [teachers, adherentFilter, baFilter, gradeFilter, echelonFilter, ancienneteMin, ancienneteMax, sortKey, sortDir]);

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
      {selectedCampagne && (
        <p className="hint">
          Période du {formatDate(selectedCampagne.periodeDebut)} au {formatDate(selectedCampagne.periodeFin)} — date CCMA :{" "}
          {formatDate(selectedCampagne.dateCcma)}.
        </p>
      )}

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
                {formatEchelonLabel(e)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Anc. échelon min (années)
          <input type="number" step="0.1" min="0" value={ancienneteMin} onChange={(e) => setAncienneteMin(e.target.value)} />
        </label>
        <label>
          Anc. échelon max (années)
          <input type="number" step="0.1" min="0" value={ancienneteMax} onChange={(e) => setAncienneteMax(e.target.value)} />
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
              <th>Ancienneté échelon</th>
              <th>Prochaine promotion</th>
              <th>Gain net</th>
              <th>Adhérent</th>
              <th>Éligibilité BA</th>
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
                    {formatEchelonLabel(t.echelonActuel)} →{" "}
                    {t.computedState ? formatEchelonLabel(t.computedState.echelonSuivant) : "—"}
                  </td>
                  <td>{formatDate(t.dateAccesEchelon)}</td>
                  <td>{formatAnciennete(t.ancienneteEchelon)}</td>
                  <td>{formatDate(t.computedState?.dateProchainePromotion ?? null)}</td>
                  <td className={t.computedState && t.computedState.gainSalaireNet > 0 ? "gain-positive" : ""}>
                    {t.computedState ? euros(t.computedState.gainSalaireNet) : "—"}
                  </td>
                  <td>
                    <span className={`badge badge-${t.matching.status.toLowerCase()}`}>{MATCHING_LABEL[t.matching.status]}</span>
                  </td>
                  <td>{ba.className ? <span className={ba.className}>{ba.label}</span> : ba.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
