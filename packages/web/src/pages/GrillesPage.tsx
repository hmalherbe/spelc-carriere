import { useEffect, useMemo, useState } from "react";
import { api, type EchelonRowApi, type GradeMappingApi, type GrillesData } from "../api.js";
import { useAuth } from "../AuthContext.js";

type Echelle = "CLASSE_NORMALE" | "HORS_CLASSE" | "CLASSE_EXCEPTIONNELLE";

const ECHELLE_LABEL: Record<Echelle, string> = {
  CLASSE_NORMALE: "Classe normale",
  HORS_CLASSE: "Hors classe",
  CLASSE_EXCEPTIONNELLE: "Classe exceptionnelle",
};

/** Splits a GradeMapping's "grade" label into a base grade name and which échelle it represents —
 * the mappings themselves encode this via a " HC"/" EXC" suffix (e.g. "CERTIFIE HC"), except for
 * grades that only ever exist in one échelle (Instituteur, MA 1/2, BI-ADMISSIBLE), which have no
 * suffix and stay CLASSE_NORMALE by convention. */
function splitGrade(grade: string): { baseGrade: string; echelle: Echelle } {
  if (grade.endsWith(" HC")) return { baseGrade: grade.slice(0, -3), echelle: "HORS_CLASSE" };
  if (grade.endsWith(" EXC")) return { baseGrade: grade.slice(0, -4), echelle: "CLASSE_EXCEPTIONNELLE" };
  return { baseGrade: grade, echelle: "CLASSE_NORMALE" };
}

function echelonSortValue(echelon: string): number {
  const n = Number(echelon);
  return Number.isFinite(n) ? n : 1000 + echelon.charCodeAt(0);
}

export function GrillesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";

  const [data, setData] = useState<GrillesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [baseGrade, setBaseGrade] = useState<string>("");
  const [echelle, setEchelle] = useState<Echelle>("CLASSE_NORMALE");

  const [editing, setEditing] = useState<Record<string, string>>({}); // echelon -> draft indice
  const [saving, setSaving] = useState<string | null>(null);

  const [showNewValeur, setShowNewValeur] = useState(false);
  const [newValeur, setNewValeur] = useState("");
  const [newValeurDate, setNewValeurDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [valeurError, setValeurError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    api
      .grilles()
      .then((d) => {
        setData(d);
        if (!baseGrade) {
          const first = d.gradeMappings[0];
          if (first) setBaseGrade(splitGrade(first.grade).baseGrade);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // baseGrade -> { CLASSE_NORMALE?: mapping, HORS_CLASSE?: mapping, CLASSE_EXCEPTIONNELLE?: mapping }
  const gradeGroups = useMemo(() => {
    const groups = new Map<string, Partial<Record<Echelle, GradeMappingApi>>>();
    for (const gm of data?.gradeMappings ?? []) {
      const { baseGrade: bg, echelle: ech } = splitGrade(gm.grade);
      const entry = groups.get(bg) ?? {};
      entry[ech] = gm;
      groups.set(bg, entry);
    }
    return groups;
  }, [data]);

  const baseGrades = useMemo(() => Array.from(gradeGroups.keys()).sort(), [gradeGroups]);
  const availableEchelles = useMemo(() => {
    const group = gradeGroups.get(baseGrade);
    if (!group) return [];
    return (["CLASSE_NORMALE", "HORS_CLASSE", "CLASSE_EXCEPTIONNELLE"] as Echelle[]).filter((e) => group[e]);
  }, [gradeGroups, baseGrade]);

  // When the grade changes, make sure the selected échelle is actually available for it.
  useEffect(() => {
    if (availableEchelles.length > 0 && !availableEchelles.includes(echelle)) {
      setEchelle(availableEchelles[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseGrade, availableEchelles]);

  const selectedMapping = gradeGroups.get(baseGrade)?.[echelle];
  const selectedGrille = data?.grilles.find((g) => g.code === selectedMapping?.grilleCode) ?? null;
  const rows = useMemo(
    () => (selectedGrille ? [...selectedGrille.rows].sort((a, b) => echelonSortValue(a.echelon) - echelonSortValue(b.echelon)) : []),
    [selectedGrille],
  );

  async function saveIndice(row: EchelonRowApi) {
    const draft = editing[row.echelon];
    if (draft === undefined) return;
    const indice = Number(draft);
    if (!Number.isFinite(indice) || indice <= 0) return;
    setSaving(row.echelon);
    try {
      await api.updateEchelonIndice(row.grilleCode, row.echelon, indice);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[row.echelon];
        return next;
      });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function submitNewValeur(e: React.FormEvent) {
    e.preventDefault();
    setValeurError(null);
    const valeur = Number(newValeur);
    if (!Number.isFinite(valeur) || valeur <= 0) {
      setValeurError("Valeur invalide");
      return;
    }
    try {
      await api.createValeurDuPoint(valeur, newValeurDate);
      setShowNewValeur(false);
      setNewValeur("");
      refresh();
    } catch (e) {
      setValeurError(String(e));
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (loading || !data) return <p>Chargement...</p>;

  return (
    <div className="import-page">
      <section className="card">
        <h2>Valeur du point d'indice</h2>
        <p>
          Valeur actuelle : <strong>{data.valeurDuPoint ? `${data.valeurDuPoint.valeur} €` : "non définie"}</strong>
          {data.valeurDuPoint && (
            <span className="hint"> (en vigueur depuis le {new Date(data.valeurDuPoint.applicableA).toLocaleDateString("fr-FR")})</span>
          )}
        </p>
        <p className="hint">
          Utilisée pour calculer les gains de salaire des <strong>prochains imports</strong> — les campagnes déjà importées ne
          sont pas recalculées automatiquement.
        </p>
        {canEdit && (
          <>
            <button type="button" className="secondary" onClick={() => setShowNewValeur((v) => !v)}>
              {showNewValeur ? "Annuler" : "Définir une nouvelle valeur"}
            </button>
            {showNewValeur && (
              <form className="inline-form" onSubmit={submitNewValeur}>
                <label>
                  Nouvelle valeur (€)
                  <input required type="number" step="0.00001" min="0" value={newValeur} onChange={(e) => setNewValeur(e.target.value)} />
                </label>
                <label>
                  En vigueur à partir du
                  <input required type="date" value={newValeurDate} onChange={(e) => setNewValeurDate(e.target.value)} />
                </label>
                <button type="submit">Enregistrer</button>
                {valeurError && <p className="error-text">{valeurError}</p>}
              </form>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Grilles indiciaires</h2>
        <div className="inline-form">
          <label>
            Grade
            <select value={baseGrade} onChange={(e) => setBaseGrade(e.target.value)}>
              {baseGrades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Échelle de rémunération
            <select value={echelle} onChange={(e) => setEchelle(e.target.value as Echelle)}>
              {availableEchelles.map((e) => (
                <option key={e} value={e}>
                  {ECHELLE_LABEL[e]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!selectedGrille ? (
          <p className="hint">Aucune grille pour cette combinaison grade/échelle.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Échelon</th>
                <th>Échelon suivant</th>
                <th>Indice</th>
                <th>Durée (années)</th>
                {canEdit && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = editing[row.echelon];
                return (
                  <tr key={row.echelon}>
                    <td>{row.echelon}</td>
                    <td>{row.echelonSuivant}</td>
                    <td>
                      {canEdit ? (
                        <input
                          type="number"
                          min={1}
                          value={draft ?? row.indice}
                          onChange={(e) => setEditing((p) => ({ ...p, [row.echelon]: e.target.value }))}
                        />
                      ) : (
                        row.indice
                      )}
                    </td>
                    <td>{row.dureeAnnees ?? "MAX"}</td>
                    {canEdit && (
                      <td>
                        {draft !== undefined && Number(draft) !== row.indice && (
                          <button type="button" onClick={() => saveIndice(row)} disabled={saving === row.echelon}>
                            {saving === row.echelon ? "..." : "Enregistrer"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
