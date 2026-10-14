import { useEffect, useState } from "react";
import { api, type Contingent, type HcExcGroupe, type HcExcImportResult, type HcExcTeacherRow } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { useCampagneContext, labelForCampagneCandidate } from "../CampagneContext.js";
import { formatPrenom, derivePeriodeFromAnneeScolaire } from "../format.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateCommissionLabel(commission: "CCMA" | "CCMI"): string {
  return commission === "CCMI" ? "Date CCMI" : "Date CCMA";
}

function hcExcFilesOnly(files: File[]): File[] {
  return files.filter((f) => /\.(pdf|txt)$/i.test(f.name));
}

function groupKey(grade: string, vivier: string | null): string {
  return `${grade}|${vivier ?? ""}`;
}

export function HorsClasseExceptionnellePage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const { campagnesAnneeSelectionnee, refresh: refreshContextCampagnes, setSelectedAnneeScolaire } = useCampagneContext();
  const hcExcCampagnes = campagnesAnneeSelectionnee.filter((c) => c.nature === "HC" || c.nature === "EXC");
  const [campagneId, setCampagneId] = useState<string | null>(null);

  useEffect(() => {
    if (hcExcCampagnes.some((c) => c.id === campagneId)) return;
    setCampagneId(hcExcCampagnes[0]?.id ?? null);
    // Gardé sur la liste jointe des id : `hcExcCampagnes` est un nouveau tableau à chaque rendu
    // (dérivé du contexte) — ne doit se redéclencher que si l'ENSEMBLE des id change réellement.
  }, [hcExcCampagnes.map((c) => c.id).join("|")]);

  const [showNewCampagne, setShowNewCampagne] = useState(false);
  const [newCampagne, setNewCampagne] = useState<{
    anneeScolaire: string;
    periodeDebut: string;
    periodeFin: string;
    dateCcma: string;
    type: "HC" | "EXC";
    commission: "CCMA" | "CCMI";
  }>({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "HC", commission: "CCMA" });
  const [campagneError, setCampagneError] = useState<string | null>(null);

  const selectedCampagne = hcExcCampagnes.find((c) => c.id === campagneId) ?? null;

  const [files, setFiles] = useState<File[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResults, setImportResults] = useState<{ fileName: string; result?: HcExcImportResult; error?: string }[]>([]);

  const [rows, setRows] = useState<HcExcTeacherRow[]>([]);
  const [groupes, setGroupes] = useState<HcExcGroupe[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  const [contingents, setContingents] = useState<Contingent[]>([]);
  const [contingentDrafts, setContingentDrafts] = useState<Map<string, { contingentAnnonce: string; contingentPropose: string }>>(new Map());
  const [contingentBusy, setContingentBusy] = useState(false);
  const [contingentError, setContingentError] = useState<string | null>(null);

  /** Rafraîchit la liste via le contexte global (partagé avec le sélecteur d'en-tête et toutes les
   * autres pages) plutôt que de refetcher indépendamment. `selectId` force la sélection d'une
   * campagne qui vient d'être créée — l'effet d'auto-sélection ci-dessus ne choisit que le PREMIER
   * candidat quand l'actuel disparaît, pas un id précis. */
  async function refreshCampagnes(selectId?: string) {
    await refreshContextCampagnes();
    if (selectId) setCampagneId(selectId);
  }

  function refreshResults() {
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
  }

  function refreshContingents() {
    if (!campagneId) {
      setContingents([]);
      return;
    }
    api.hcExcContingents(campagneId).then(setContingents);
  }

  useEffect(() => {
    refreshResults();
    refreshContingents();
    setImportResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagneId]);

  // The contingent editor shows one row per (grade, vivier) group already known to this campagne —
  // from an existing Contingent row, or from an already-imported group with none set yet — seeded
  // into editable draft state whenever the underlying data changes.
  useEffect(() => {
    const drafts = new Map<string, { contingentAnnonce: string; contingentPropose: string }>();
    for (const c of contingents) {
      drafts.set(groupKey(c.grade, c.vivier), {
        contingentAnnonce: c.contingentAnnonce != null ? String(c.contingentAnnonce) : "",
        contingentPropose: c.contingentPropose != null ? String(c.contingentPropose) : "",
      });
    }
    for (const g of groupes) {
      const key = groupKey(g.grade, g.vivier);
      if (!drafts.has(key)) drafts.set(key, { contingentAnnonce: "", contingentPropose: "" });
    }
    setContingentDrafts(drafts);
  }, [contingents, groupes]);

  async function createCampagne(e: React.FormEvent) {
    e.preventDefault();
    setCampagneError(null);
    try {
      const created = await api.createCampagne(newCampagne);
      setShowNewCampagne(false);
      setNewCampagne({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "HC", commission: "CCMA" });
      // La nouvelle campagne peut appartenir à une année scolaire différente de celle actuellement
      // sélectionnée en en-tête — sans ça, `hcExcCampagnes` (filtré sur l'année sélectionnée) ne la
      // contiendrait pas et `created.id` ne correspondrait à aucune option du sélecteur ci-dessous.
      setSelectedAnneeScolaire(created.anneeScolaire);
      refreshCampagnes(created.id);
    } catch (e) {
      setCampagneError(String(e));
    }
  }

  async function submitFiles(e: React.FormEvent) {
    e.preventDefault();
    if (!campagneId || files.length === 0) return;
    setImportBusy(true);
    const results: { fileName: string; result?: HcExcImportResult; error?: string }[] = [];
    setImportResults(results);
    // Sequential for the same reason as ImportPage.tsx's rectorat import: teacher-identity lookups
    // read the DB fresh per file, so two files running at once could each create a duplicate teacher
    // for a name appearing in both.
    for (const file of files) {
      try {
        const result = await api.importHcExc(campagneId, file);
        results.push({ fileName: file.name, result });
      } catch (err) {
        results.push({ fileName: file.name, error: String(err) });
      }
      setImportResults([...results]);
    }
    setFiles([]);
    setImportBusy(false);
    refreshResults();
    refreshContingents();
  }

  async function saveContingents() {
    if (!campagneId) return;
    setContingentBusy(true);
    setContingentError(null);
    try {
      const payload = [...contingentDrafts.entries()].map(([key, draft]) => {
        const sep = key.indexOf("|");
        const grade = key.slice(0, sep);
        const vivierRaw = key.slice(sep + 1);
        return {
          grade,
          vivier: vivierRaw || null,
          contingentAnnonce: draft.contingentAnnonce.trim() === "" ? null : Number(draft.contingentAnnonce),
          contingentPropose: draft.contingentPropose.trim() === "" ? null : Number(draft.contingentPropose),
        };
      });
      const saved = await api.updateHcExcContingents(campagneId, payload);
      setContingents(saved);
      refreshResults();
    } catch (e) {
      setContingentError(String(e));
    } finally {
      setContingentBusy(false);
    }
  }

  return (
    <div className="import-page">
      <section className="card">
        <h2>Hors classe / Classe exceptionnelle</h2>
        <p className="hint">
          Suivi des passages à la hors-classe et à la classe exceptionnelle — import du tableau d'avancement du rectorat
          (barème et rang), rapprochement adhérents, contingent par grade (pour la classe exceptionnelle, par vivier), et
          détermination des promus par comparaison rang / contingent.
        </p>
        <div className="toolbar">
          {hcExcCampagnes.length > 0 ? (
            <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
              {hcExcCampagnes.map((c) => (
                <option key={c.id} value={c.id}>
                  {labelForCampagneCandidate(c, 2)} ({c._count.teacherSnapshots} enseignants)
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">
              Aucune campagne HC/EXC pour l'année scolaire sélectionnée — créez-en une ci-dessous, ou changez d'année
              scolaire dans l'en-tête.
            </span>
          )}
          {canEdit && (
            <button type="button" className="secondary" onClick={() => setShowNewCampagne((v) => !v)}>
              {showNewCampagne ? "Annuler" : "Nouvelle campagne"}
            </button>
          )}
        </div>

        {showNewCampagne && (
          <form className="inline-form" onSubmit={createCampagne}>
            <label>
              Processus
              <select value={newCampagne.type} onChange={(e) => setNewCampagne((s) => ({ ...s, type: e.target.value as "HC" | "EXC" }))}>
                <option value="HC">Hors classe</option>
                <option value="EXC">Classe exceptionnelle</option>
              </select>
            </label>
            <label>
              Commission
              <select
                value={newCampagne.commission}
                onChange={(e) => setNewCampagne((s) => ({ ...s, commission: e.target.value as "CCMA" | "CCMI" }))}
              >
                <option value="CCMA">CCMA (second degré)</option>
                <option value="CCMI">CCMI (premier degré)</option>
              </select>
            </label>
            <label>
              Année scolaire
              <input
                required
                placeholder="2024-2025"
                value={newCampagne.anneeScolaire}
                onChange={(e) => {
                  const anneeScolaire = e.target.value;
                  const derived = derivePeriodeFromAnneeScolaire(anneeScolaire);
                  setNewCampagne((s) => ({ ...s, anneeScolaire, ...(derived ?? {}) }));
                }}
              />
            </label>
            <label>
              Début de période
              <input
                required
                type="date"
                value={newCampagne.periodeDebut}
                onChange={(e) => setNewCampagne((s) => ({ ...s, periodeDebut: e.target.value }))}
              />
            </label>
            <label>
              Fin de période
              <input
                required
                type="date"
                value={newCampagne.periodeFin}
                onChange={(e) => setNewCampagne((s) => ({ ...s, periodeFin: e.target.value }))}
              />
            </label>
            <label>
              {dateCommissionLabel(newCampagne.commission)}
              <input required type="date" value={newCampagne.dateCcma} onChange={(e) => setNewCampagne((s) => ({ ...s, dateCcma: e.target.value }))} />
            </label>
            <button type="submit">Créer</button>
            {campagneError && <p className="error-text">{campagneError}</p>}
          </form>
        )}
      </section>

      {selectedCampagne && canEdit && (
        <section className="card">
          <h2>Import tableau d'avancement (PDF ou texte)</h2>
          <p className="hint">
            Fichier "Tableau Avancement" fourni par le rectorat (un fichier par grade — et pour la classe exceptionnelle, par
            vivier). Le grade, le vivier et le processus sont détectés automatiquement à partir du contenu. Réimporter un
            fichier pour un grade/vivier déjà chargé dans cette campagne remplace entièrement les fiches précédentes.
          </p>
          <form className="inline-form" onSubmit={submitFiles}>
            <label>
              Fichiers
              <input type="file" accept="application/pdf,.pdf,.txt" multiple onChange={(e) => setFiles(hcExcFilesOnly(Array.from(e.target.files ?? [])))} />
            </label>
            <button type="submit" disabled={files.length === 0 || importBusy}>
              {importBusy
                ? `Import en cours (${importResults.length}/${files.length})...`
                : files.length > 1
                  ? `Importer les ${files.length} fichiers`
                  : "Importer"}
            </button>
          </form>
          {importResults.length > 0 && (
            <div className="import-result">
              {importResults.map((r, i) => (
                <div key={i} className={i > 0 ? "import-result-row" : undefined}>
                  <p>
                    <strong>{r.fileName}</strong>
                    {r.error && <span className="error-text"> — échec : {r.error}</span>}
                  </p>
                  {r.result && (
                    <div className="import-result-grade">
                      <p>
                        {" "}
                        — <strong>{r.result.imported}</strong> fiches importées, grade : <strong>{r.result.grade}</strong>
                        {r.result.vivier && (
                          <>
                            {" "}
                            , vivier : <strong>{r.result.vivier}</strong>
                          </>
                        )}
                      </p>
                      {r.result.bareme && (
                        <p className="hint">
                          Score classe exceptionnelle calculé pour {r.result.bareme.calcules} enseignant(s)
                          {r.result.bareme.nonCalcules > 0 && <> — {r.result.bareme.nonCalcules} non calculable(s) (avis ou échelon inconnu)</>}.
                        </p>
                      )}
                      {r.result.warnings.length > 0 && (
                        <details>
                          <summary>{r.result.warnings.length} avertissement(s)</summary>
                          <ul>
                            {r.result.warnings.map((w, k) => (
                              <li key={k}>
                                {w.nomUsage} {formatPrenom(w.prenom)} — {w.warnings.join("; ")}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedCampagne && groupes.length > 0 && (
        <section className="card">
          <h2>Contingent</h2>
          <p className="hint">
            Le contingent officiel une fois annoncé par le rectorat ("annoncé"), ou en attendant une estimation de travail du
            syndicat ("proposé") — utilisé pour déterminer les promus (rang ≤ contingent). Le rang comparé est toujours celui
            donné par le rectorat, jamais recalculé.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Vivier</th>
                <th>Contingent annoncé</th>
                <th>Contingent proposé</th>
                <th>Dernier promu (rang)</th>
                <th>Dernier promu (barème)</th>
              </tr>
            </thead>
            <tbody>
              {groupes.map((g) => {
                const key = groupKey(g.grade, g.vivier);
                const draft = contingentDrafts.get(key) ?? { contingentAnnonce: "", contingentPropose: "" };
                return (
                  <tr key={key}>
                    <td>{g.grade}</td>
                    <td>{g.vivier ?? "—"}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={draft.contingentAnnonce}
                        onChange={(e) => {
                          const next = new Map(contingentDrafts);
                          next.set(key, { ...draft, contingentAnnonce: e.target.value });
                          setContingentDrafts(next);
                        }}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={draft.contingentPropose}
                        onChange={(e) => {
                          const next = new Map(contingentDrafts);
                          next.set(key, { ...draft, contingentPropose: e.target.value });
                          setContingentDrafts(next);
                        }}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>{g.rangDernierPromu ?? "—"}</td>
                    <td>{g.totalBaremeDernierPromu ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canEdit && (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button type="button" onClick={saveContingents} disabled={contingentBusy}>
                {contingentBusy ? "Enregistrement..." : "Enregistrer le contingent"}
              </button>
              {contingentError && <p className="error-text">{contingentError}</p>}
            </div>
          )}
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
