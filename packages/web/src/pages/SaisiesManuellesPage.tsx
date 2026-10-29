import { useEffect, useState, type FormEvent } from "react";
import { GRADE_MAPPINGS, GRILLES, type GrilleCode } from "@spelc/domain";
import { api, ApiError, type SaisieManuelleInput, type SaisieManuelleResult, type TeacherListItem } from "../api.js";
import { useCampagneSelection, labelForCampagneCandidate } from "../CampagneContext.js";
import { formatPrenom, formatEchelonLabel } from "../format.js";

/** Échelon options pour un grade donné — zero-paddées à 2 chiffres pour les échelons numériques,
 * même convention que partout ailleurs (routes/imports.ts, DashboardPage.tsx), inchangées pour les
 * codes lettrés (hors-classe/classe exceptionnelle agrégés). */
function echelonOptions(grade: string): string[] {
  const mapping = GRADE_MAPPINGS.find((g) => g.grade === grade);
  if (!mapping) return [];
  const rows = GRILLES[mapping.grille as GrilleCode] ?? [];
  return rows.map((r) => (typeof r.echelon === "number" ? String(r.echelon).padStart(2, "0") : String(r.echelon)));
}

const EMPTY_FORM = {
  nom: "",
  prenom: "",
  grade: GRADE_MAPPINGS[0].grade,
  echelonActuel: "",
  isAdherent: "" as "" | "oui" | "non",
  dateAccesEchelon: "",
  ancienneteADeduire: "",
  ancienneteAReporter: "",
};

function euros(n: number): string {
  return `${n >= 0 ? "+" : ""}${n} €`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function SaisiesManuellesPage() {
  const { candidates, campagneId } = useCampagneSelection(["ECHELON"]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaisieManuelleResult | null>(null);

  const [entries, setEntries] = useState<TeacherListItem[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  async function loadEntries() {
    if (!campagneId) return;
    setLoadingEntries(true);
    try {
      setEntries(await api.saisiesManuelles(campagneId));
      setEntriesError(null);
    } catch (e) {
      setEntriesError(String(e));
    } finally {
      setLoadingEntries(false);
    }
  }

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagneId]);

  const options = echelonOptions(form.grade);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!campagneId) return;
    setError(null);
    setResult(null);

    if (!form.nom.trim() || !form.prenom.trim() || !form.echelonActuel || form.isAdherent === "" || !form.dateAccesEchelon) {
      setError("Nom, prénom, échelon, adhérent/non-adhérent et date de l'échelon actuel sont obligatoires.");
      return;
    }

    const input: SaisieManuelleInput = {
      campagneId,
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      grade: form.grade,
      echelonActuel: form.echelonActuel,
      isAdherent: form.isAdherent === "oui",
      dateAccesEchelon: form.dateAccesEchelon,
      ancienneteADeduire: form.ancienneteADeduire.trim() || null,
      ancienneteAReporter: form.ancienneteAReporter.trim() || null,
    };

    setSubmitting(true);
    try {
      const res = await api.creerSaisieManuelle(input);
      setResult(res);
      setForm({ ...EMPTY_FORM, grade: form.grade });
      await loadEntries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h2>Saisies manuelles</h2>
      <p className="hint">
        Pour un enseignant promouvable oublié par le rectorat : saisir ici les informations minimales nécessaires au calcul de
        sa prochaine promotion, de son gain de salaire et de son éligibilité à la bonification d'ancienneté (BA). La fiche créée
        apparaît ensuite dans l'onglet "Enseignants" et dans le Mailing comme toute autre fiche.
      </p>

      {candidates.length > 1 && (
        <p className="hint">
          Campagne : {candidates.find((c) => c.id === campagneId)?.anneeScolaire} —{" "}
          {labelForCampagneCandidate(candidates.find((c) => c.id === campagneId)!, 1)}
        </p>
      )}

      <form className="form-panel" onSubmit={submit}>
        <label>
          Nom *
          <input required value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} />
        </label>
        <label>
          Prénom *
          <input required value={form.prenom} onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))} />
        </label>
        <label>
          Grade *
          <select
            value={form.grade}
            onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value, echelonActuel: "" }))}
          >
            {GRADE_MAPPINGS.map((g) => (
              <option key={g.grade} value={g.grade}>
                {g.grade}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon (avant promotion) *
          <select required value={form.echelonActuel} onChange={(e) => setForm((f) => ({ ...f, echelonActuel: e.target.value }))}>
            <option value="" disabled>
              —
            </option>
            {options.map((o) => (
              <option key={o} value={o}>
                {formatEchelonLabel(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Adhérent *
          <select required value={form.isAdherent} onChange={(e) => setForm((f) => ({ ...f, isAdherent: e.target.value as "oui" | "non" }))}>
            <option value="" disabled>
              —
            </option>
            <option value="oui">Adhérent</option>
            <option value="non">Non adhérent</option>
          </select>
        </label>
        <label>
          Date de l'échelon actuel *
          <input required type="date" value={form.dateAccesEchelon} onChange={(e) => setForm((f) => ({ ...f, dateAccesEchelon: e.target.value }))} />
        </label>
        <label>
          Ancienneté à déduire (optionnel)
          <input
            placeholder='ex. "01a06m00j"'
            value={form.ancienneteADeduire}
            onChange={(e) => setForm((f) => ({ ...f, ancienneteADeduire: e.target.value }))}
          />
        </label>
        <label>
          Ancienneté à reporter (optionnel)
          <input
            placeholder='ex. "00a11m05j"'
            value={form.ancienneteAReporter}
            onChange={(e) => setForm((f) => ({ ...f, ancienneteAReporter: e.target.value }))}
          />
        </label>
        <p className="hint">Format "AAaMMmJJj" (années/mois/jours), ex. "01a06m00j" pour 1 an et 6 mois.</p>

        <button type="submit" disabled={submitting || !campagneId}>
          {submitting ? "Calcul..." : "Calculer et enregistrer"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>

      {result && (
        <div className="result-card">
          <h3>Résultat</h3>
          {result.warning && <p className="error-text">{result.warning}</p>}
          <p>Date de prochaine promotion : {formatDate(result.dateProchainePromotion)}</p>
          <p>Gain mensuel net de salaire : {result.gainSalaireNet != null ? euros(result.gainSalaireNet) : "—"}</p>
          <p>
            Éligibilité à la BA :{" "}
            {result.baEchelonDepart == null
              ? "non applicable (échelon hors fenêtre BA — 6 ou 8 uniquement)"
              : result.baEligible
                ? `éligible (échelon de départ ${result.baEchelonDepart})`
                : `non éligible en l'état (hors fenêtre d'ancienneté pour l'échelon ${result.baEchelonDepart})`}
          </p>
        </div>
      )}

      <h3>Saisies déjà enregistrées pour cette campagne</h3>
      {loadingEntries && <p>Chargement...</p>}
      {entriesError && <p className="error-text">{entriesError}</p>}
      {!loadingEntries && entries.length === 0 && <p className="hint">Aucune saisie manuelle pour cette campagne.</p>}
      {entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Grade</th>
              <th>Échelon</th>
              <th>Prochaine promotion</th>
              <th>Gain net</th>
              <th>Éligibilité BA</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((t) => (
              <tr key={t.teacherId}>
                <td>{t.nom}</td>
                <td>{formatPrenom(t.prenom)}</td>
                <td>{t.grade}</td>
                <td>{formatEchelonLabel(t.echelonActuel)}</td>
                <td>{formatDate(t.computedState?.dateProchainePromotion ?? null)}</td>
                <td>{t.computedState ? euros(t.computedState.gainSalaireNet) : "—"}</td>
                <td>{t.baEchelonDepart == null ? "—" : t.baEligible ? "Éligible" : "Non éligible"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
