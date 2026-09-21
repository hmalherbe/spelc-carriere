import { useEffect, useMemo, useState } from "react";
import { api, type Campagne, type Contingent, type HcExcGroupe, type HcExcImportResult, type HcExcTeacherRow } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { formatPrenom } from "../format.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same convention as ImportPage.tsx's derivePeriodeFromAnneeScolaire — kept in sync there. */
function derivePeriodeFromAnneeScolaire(anneeScolaire: string): { periodeDebut: string; periodeFin: string } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(anneeScolaire.trim());
  if (!m) return null;
  const [, anneeDebut, anneeFin] = m;
  return { periodeDebut: `${anneeDebut}-09-01`, periodeFin: `${anneeFin}-08-31` };
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

  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [showNewCampagne, setShowNewCampagne] = useState(false);
  const [newCampagne, setNewCampagne] = useState<{ anneeScolaire: string; periodeDebut: string; periodeFin: string; dateCcma: string; type: "HC" | "EXC" }>(
    { anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "HC" },
  );
  const [campagneError, setCampagneError] = useState<string | null>(null);

  const hcExcCampagnes = useMemo(() => campagnes.filter((c) => c.type === "HC" || c.type === "EXC"), [campagnes]);
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

  function refreshCampagnes(selectId?: string) {
    api.campagnes().then((c) => {
      setCampagnes(c);
      const hcExc = c.filter((x) => x.type === "HC" || x.type === "EXC");
      if (selectId) setCampagneId(selectId);
      else if (!campagneId && hcExc.length > 0) setCampagneId(hcExc[0].id);
    });
  }

  useEffect(() => {
    refreshCampagnes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setNewCampagne({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "HC" });
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
                  {c.type} {c.anneeScolaire} ({c._count.teacherSnapshots} enseignants)
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">Aucune campagne HC/EXC — créez-en une pour commencer.</span>
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
              Date CCMA
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
