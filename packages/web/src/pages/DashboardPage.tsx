import { useEffect, useMemo, useState } from "react";
import { api, downloadBlob, type TeacherListItem } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { useCampagneSelection } from "../CampagneContext.js";
import { formatPrenom, formatEchelonLabel } from "../format.js";

const MATCHING_LABEL: Record<string, string> = {
  AUTO_CONFIRMED: "Adhérent (auto)",
  CONFIRMED: "Adhérent (confirmé)",
  PENDING_REVIEW: "À vérifier",
  REJECTED: "Non lié",
  NON_ADHERENT: "Non adhérent",
};

/** isAdherentCorrige (Teacher.isAdherentCorrige's own doc comment) force l'affichage "Adhérent"
 * même sans aucun rapprochement réel — seul moyen pour une fiche "Saisie manuelle" (aucun
 * MatchCandidate possible) d'apparaître adhérente ici ; voir routes/teachers.ts's
 * computeTeacherList pour le même override côté API. */
function matchingLabel(t: TeacherListItem): string {
  if (t.matching.status === "NON_ADHERENT" && t.matching.isAdherentCorrige) return "Adhérent (forcé)";
  return MATCHING_LABEL[t.matching.status];
}

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
  if (t.matching.status === "NON_ADHERENT") return t.matching.isAdherentCorrige === true;
  return t.matching.status === "AUTO_CONFIRMED" || t.matching.status === "CONFIRMED" || t.matching.status === "PENDING_REVIEW";
}

/** Numeric-aware échelon ordering — échelon is a free-form string ("06", "6", "A1"...); lettered
 * échelons (hors-classe/classe exceptionnelle) sort after every numeric one. */
function echelonSortValue(echelon: string): number {
  const n = Number(echelon);
  if (Number.isFinite(n)) return n;
  const suffix = Number(echelon.slice(1));
  return 1000 + echelon.charCodeAt(0) * 100 + (Number.isFinite(suffix) ? suffix : 0);
}

// La règle BA parle d'échelon 6 ou 8 (rendez-vous de carrière durant la 2e année du 6e échelon /
// entre le 18e et le 30e mois du 8e) — un échelon de DÉPART. "Promu BA" signifie que la bonification
// (le passage accéléré vers l'échelon suivant) a été accordée, pas que l'enseignant a déjà atteint
// cet échelon suivant : tant que l'échéance donnée par le rectorat lui-même (à côté du marqueur
// "BA.") n'est pas passée, il est toujours À l'échelon de départ. La colonne "Échelon" reflète donc
// toujours ce départ pour un candidat BA (voir routes/teachers.ts), jamais l'arrivée par
// anticipation — d'où la cohérence garantie entre elle et "(départ éch. X)" ci-dessous.
function baCell(t: TeacherListItem): { label: string; className: string } {
  // Gated on baStatus, PAS sur baEligible : un enseignant sans marqueur "BA." (suivi sur un autre
  // mécanisme AN/CL/RE ce tour-ci, ou hors-classe/classe-exceptionnelle) n'a simplement rien à voir
  // avec la BA — lui afficher "Non éligible" serait un faux signal sans rapport avec sa situation
  // réelle, même si son échelon/ancienneté ne serait de toute façon pas dans la fenêtre BA.
  if (t.baStatus === null) return { label: "—", className: "" };
  // Garde-fou plutôt que condition attendue-à-être-fausse : la colonne Échelon montre toujours le
  // départ pour un candidat BA désormais, sauf échec ponctuel du calcul de grille (voir
  // routes/teachers.ts, cas try/catch) — auquel cas mieux vaut ne pas afficher un échelon de départ
  // qui ne correspondrait plus à ce que montre la colonne Échelon.
  const atDepart = t.baEchelonDepart != null && Number(t.echelonActuel) === t.baEchelonDepart;
  const dep = atDepart ? ` (départ éch. ${t.baEchelonDepart})` : "";
  // Le marqueur "Pro" du rectorat tranche directement, sans estimation — y compris pour les
  // agrégés, dont la BA se décide désormais directement au niveau académique (pas de remontée
  // nationale au ministère, confirmé par le syndicat le 2026-10-09).
  if (t.baStatus === "promu") return { label: `Promu BA${dep}`, className: "badge badge-promu_estime" };
  return { label: `Éligible à la BA - non promu${dep}`, className: "badge badge-non_promu_estime" };
}

type SortKey = "fichier" | "nom" | "grade" | "echelon";
type AdherentFilter = "all" | "adherent" | "non_adherent";
type BaFilter = "all" | "eligible" | "non_eligible";

type ManualCorrectionField = "ancienneteADeduire" | "ancienneteAReporter";
const CORRECTION_LABEL: Record<ManualCorrectionField, string> = {
  ancienneteADeduire: "Anc. à déduire",
  ancienneteAReporter: "Anc. à reporter",
};

export function DashboardPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";
  const { candidates: campagnes, campagneId } = useCampagneSelection(["ECHELON"]);
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adherentFilter, setAdherentFilter] = useState<AdherentFilter>("all");
  const [baFilter, setBaFilter] = useState<BaFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [departementFilter, setDepartementFilter] = useState<string>("all");
  const [echelonFilter, setEchelonFilter] = useState<string>("all");
  const [ancienneteMin, setAncienneteMin] = useState<string>("");
  const [ancienneteMax, setAncienneteMax] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("fichier");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Édition des corrections manuelles "ancienneté à déduire" / "ancienneté à reporter" (voir
  // Teacher.ancienneteADeduire/ancienneteAReporter côté API) — un seul champ, un seul enseignant à
  // la fois, comme le montre le pattern équivalent pour l'email dans MailingPage. Les deux
  // corrections partagent la même forme et le même comportement, seul le champ édité diffère.
  const [editingCorrection, setEditingCorrection] = useState<{ teacherId: string; field: ManualCorrectionField } | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [correctionNoteDraft, setCorrectionNoteDraft] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  function refreshTeachers() {
    // null est désormais un cas durable (année scolaire sans campagne d'échelon pour l'instant),
    // pas juste transitoire avant le premier chargement — vide la liste plutôt que de garder
    // affichés les enseignants d'une campagne qu'on vient de quitter.
    if (!campagneId) {
      setTeachers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .teachers(campagneId)
      .then(setTeachers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(refreshTeachers, [campagneId]);

  async function exportTeachers() {
    if (!campagneId) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await api.teachersExportXlsx(campagneId);
      downloadBlob(blob, "enseignants_promouvables.xlsx");
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  function startEditCorrection(t: TeacherListItem, field: ManualCorrectionField) {
    setEditingCorrection({ teacherId: t.teacherId, field });
    // Pour "ancienneté à reporter" : si aucune correction manuelle n'est encore en place, on
    // pré-remplit avec la figure brute du rectorat (même encodage "AAaMMmJJj") plutôt que de partir
    // d'un champ vide — l'admin n'a alors qu'à l'ajuster plutôt que la ressaisir de zéro.
    const manualValue = field === "ancienneteADeduire" ? t.ancienneteADeduire : t.ancienneteAReporter;
    const rectoratValue = field === "ancienneteAReporter" ? t.ancienneteAReporterRectorat : null;
    setCorrectionDraft(manualValue ?? rectoratValue ?? "");
    setCorrectionNoteDraft((field === "ancienneteADeduire" ? t.ancienneteADeduireNote : t.ancienneteAReporterNote) ?? "");
    setCorrectionError(null);
  }

  async function saveCorrection() {
    if (!editingCorrection) return;
    setSavingCorrection(true);
    setCorrectionError(null);
    try {
      const value = correctionDraft.trim() || null;
      const note = correctionNoteDraft.trim() || null;
      if (editingCorrection.field === "ancienneteADeduire") {
        await api.updateAncienneteADeduire(editingCorrection.teacherId, value, note);
      } else {
        await api.updateAncienneteAReporter(editingCorrection.teacherId, value, note);
      }
      setEditingCorrection(null);
      refreshTeachers();
    } catch (e) {
      setCorrectionError(String(e));
    } finally {
      setSavingCorrection(false);
    }
  }

  const selectedCampagne = useMemo(() => campagnes.find((c) => c.id === campagneId) ?? null, [campagnes, campagneId]);

  const grades = useMemo(() => Array.from(new Set(teachers.map((t) => t.grade))).sort(), [teachers]);
  // Vide pour une campagne CCMA (pas de découpage départemental) — le filtre ne s'affiche alors pas.
  const departements = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.departement).filter((d): d is string => d != null))).sort(),
    [teachers],
  );
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
      if (departementFilter !== "all" && t.departement !== departementFilter) return false;
      if (echelonFilter !== "all" && t.echelonActuel !== echelonFilter) return false;
      if (min !== null && (t.ancienneteEchelon == null || t.ancienneteEchelon < min)) return false;
      if (max !== null && (t.ancienneteEchelon == null || t.ancienneteEchelon > max)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortKey === "fichier") {
        // Chaque grade provient de son propre fichier rectorat — regrouper par grade puis
        // reproduire l'ordre d'apparition dans ce fichier (fileOrder) est ce qui se rapproche le
        // plus d'un "ordre du fichier" unique quand plusieurs grades sont chargés dans la campagne.
        cmp = a.grade.localeCompare(b.grade) || a.fileOrder - b.fileOrder;
      } else if (sortKey === "nom") {
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
  }, [teachers, adherentFilter, baFilter, gradeFilter, departementFilter, echelonFilter, ancienneteMin, ancienneteMax, sortKey, sortDir]);

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

  function correctionCell(t: TeacherListItem, field: ManualCorrectionField) {
    if (editingCorrection?.teacherId === t.teacherId && editingCorrection.field === field) {
      return (
        <div className="row-actions">
          <input
            value={correctionDraft}
            onChange={(e) => setCorrectionDraft(e.target.value)}
            placeholder="AAaMMmJJj (ex. 07a00m00j)"
            style={{ width: "10em" }}
            autoFocus
          />
          <button type="button" disabled={savingCorrection} onClick={saveCorrection}>
            {savingCorrection ? "..." : "Enregistrer"}
          </button>
          <button type="button" className="secondary" onClick={() => setEditingCorrection(null)} disabled={savingCorrection}>
            Annuler
          </button>
          {correctionError && <span className="error-text">{correctionError}</span>}
        </div>
      );
    }
    const value = field === "ancienneteADeduire" ? t.ancienneteADeduire : t.ancienneteAReporter;
    const note = field === "ancienneteADeduire" ? t.ancienneteADeduireNote : t.ancienneteAReporterNote;
    // Pour "ancienneté à reporter" uniquement : la figure brute indiquée par le rectorat
    // (marqueur AN./CL./RE., voir TeacherListItem.ancienneteAReporterRectorat) — purement
    // informative, jamais la valeur réellement utilisée pour le calcul de date, mais utile pour
    // comprendre pourquoi cette colonne est vide pour la plupart des enseignants (aucune correction
    // manuelle n'est normalement nécessaire). Affichée seulement quand aucune correction manuelle
    // n'est en place ; une fois une correction saisie, elle remplace entièrement la dérivation
    // automatique (voir ancienneteReportee.ts) et c'est elle seule qui compte.
    const rectoratValue = field === "ancienneteAReporter" ? t.ancienneteAReporterRectorat : null;
    return (
      <div className="row-actions">
        <span title={note ?? undefined}>
          {value ?? (rectoratValue ? (
            <span
              style={{ color: "var(--muted, #888)", fontStyle: "italic" }}
              title="Indication brute du rectorat, non utilisée pour le calcul tant qu'aucune correction manuelle n'est saisie"
            >
              {rectoratValue}
            </span>
          ) : (
            "—"
          ))}
        </span>
        {canEdit && (
          <button type="button" className="secondary" onClick={() => startEditCorrection(t, field)}>
            {value || rectoratValue ? "Modifier" : "Ajouter"}
          </button>
        )}
      </div>
    );
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Enseignants promouvables</h2>
        <button type="button" className="secondary" onClick={exportTeachers} disabled={!campagneId || exporting}>
          {exporting ? "Export en cours..." : "Export Excel"}
        </button>
        {exportError && <span className="error-text">{exportError}</span>}
      </div>
      {campagnes.length === 0 && (
        <p className="hint">
          Aucune campagne d'avancement d'échelon (CCMA/CCMI) pour l'année scolaire sélectionnée — créez-la depuis la page
          Import, ou changez d'année scolaire dans l'en-tête.
        </p>
      )}
      {selectedCampagne && (
        <p className="hint">
          Période du {formatDate(selectedCampagne.periodeDebut)} au {formatDate(selectedCampagne.periodeFin)} — date CCMA :{" "}
          {formatDate(selectedCampagne.dateCcma)}. Par défaut, la liste est triée par grade puis dans le même ordre
          que le fichier du rectorat correspondant — cliquez sur un en-tête de colonne pour trier autrement. Les
          colonnes « Anc. à déduire » et « Anc. à reporter » permettent de corriger, au cas par cas, les rares
          dossiers où la date d'accès à l'échelon du rectorat ne reflète plus l'ancienneté réelle (disponibilité,
          congé longue durée...) ou où le report d'ancienneté / reclassement n'a pas été détecté automatiquement
          depuis le fichier — la date de prochaine promotion est recalculée immédiatement.
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
        {departements.length > 0 && (
          <label>
            Département
            <select value={departementFilter} onChange={(e) => setDepartementFilter(e.target.value)}>
              <option value="all">Tous</option>
              {departements.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSortKey("fichier");
            setSortDir("asc");
          }}
        >
          Trier comme le fichier rectorat
        </button>
      </div>

      {loading ? (
        <p>Chargement...</p>
      ) : (
        <table className="data-table sticky-header">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("nom")}>
                Nom{sortIndicator("nom")}
              </th>
              <th>Prénom</th>
              <th className="sortable" onClick={() => toggleSort("grade")}>
                Grade{sortIndicator("grade")}
              </th>
              {departements.length > 0 && <th>Département</th>}
              <th className="sortable" onClick={() => toggleSort("echelon")}>
                Échelon{sortIndicator("echelon")}
              </th>
              <th>Date échelon actuel</th>
              <th>Ancienneté échelon</th>
              <th>{CORRECTION_LABEL.ancienneteADeduire}</th>
              <th>{CORRECTION_LABEL.ancienneteAReporter}</th>
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
                  <td>
                    {t.nom}
                    {t.isManual && (
                      <span className="badge" title="Fiche créée depuis l'onglet Saisies manuelles">
                        {" "}
                        Saisie manuelle
                      </span>
                    )}
                  </td>
                  <td>{formatPrenom(t.prenom)}</td>
                  <td>{t.grade}</td>
                  {departements.length > 0 && <td>{t.departement ?? "—"}</td>}
                  <td>
                    {formatEchelonLabel(t.echelonActuel)} →{" "}
                    {t.computedState ? formatEchelonLabel(t.computedState.echelonSuivant) : "—"}
                  </td>
                  <td>{formatDate(t.dateAccesEchelon)}</td>
                  <td>{formatAnciennete(t.ancienneteEchelon)}</td>
                  <td>{correctionCell(t, "ancienneteADeduire")}</td>
                  <td>{correctionCell(t, "ancienneteAReporter")}</td>
                  <td>{formatDate(t.computedState?.dateProchainePromotion ?? null)}</td>
                  <td className={t.computedState && t.computedState.gainSalaireNet > 0 ? "gain-positive" : ""}>
                    {t.computedState ? euros(t.computedState.gainSalaireNet) : "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${t.matching.status === "NON_ADHERENT" && t.matching.isAdherentCorrige ? "badge-auto_confirmed" : `badge-${t.matching.status.toLowerCase()}`}`}
                    >
                      {matchingLabel(t)}
                    </span>
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
