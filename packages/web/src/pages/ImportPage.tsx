import { useEffect, useState } from "react";
import { api, type AdherentImportResult, type Campagne, type RectoratImportResult } from "../api.js";
import { useAuth } from "../AuthContext.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ImportPage() {
  const { user } = useAuth();
  const canImport = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [showNewCampagne, setShowNewCampagne] = useState(false);
  const [newCampagne, setNewCampagne] = useState({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso() });
  const [campagneError, setCampagneError] = useState<string | null>(null);

  const [rectoratFiles, setRectoratFiles] = useState<File[]>([]);
  const [rectoratBusy, setRectoratBusy] = useState(false);
  const [rectoratResults, setRectoratResults] = useState<{ fileName: string; result?: RectoratImportResult; error?: string }[]>([]);

  const [adherentsFile, setAdherentsFile] = useState<File | null>(null);
  const [adherentsBusy, setAdherentsBusy] = useState(false);
  const [adherentsResult, setAdherentsResult] = useState<AdherentImportResult | null>(null);
  const [adherentsError, setAdherentsError] = useState<string | null>(null);

  function refreshCampagnes(selectId?: string) {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (selectId) setCampagneId(selectId);
      else if (!campagneId && c.length > 0) setCampagneId(c[0].id);
    });
  }

  useEffect(() => {
    refreshCampagnes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createCampagne(e: React.FormEvent) {
    e.preventDefault();
    setCampagneError(null);
    try {
      const created = await api.createCampagne(newCampagne);
      setShowNewCampagne(false);
      setNewCampagne({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso() });
      refreshCampagnes(created.id);
    } catch (e) {
      setCampagneError(String(e));
    }
  }

  async function submitRectorat(e: React.FormEvent) {
    e.preventDefault();
    if (!campagneId || rectoratFiles.length === 0) return;
    setRectoratBusy(true);
    const results: { fileName: string; result?: RectoratImportResult; error?: string }[] = [];
    setRectoratResults(results);
    // Sequential, not Promise.all: each file's teacher-matching lookup reads the DB fresh, so
    // running several at once could let two files independently decide to create the same new
    // teacher (a name appearing in more than one grade export) instead of reusing one row.
    for (const file of rectoratFiles) {
      try {
        const result = await api.importRectorat(campagneId, file);
        results.push({ fileName: file.name, result });
      } catch (err) {
        results.push({ fileName: file.name, error: String(err) });
      }
      setRectoratResults([...results]);
    }
    refreshCampagnes(campagneId);
    setRectoratBusy(false);
  }

  async function submitAdherents(e: React.FormEvent) {
    e.preventDefault();
    if (!adherentsFile) return;
    setAdherentsBusy(true);
    setAdherentsError(null);
    setAdherentsResult(null);
    try {
      const result = await api.importAdherents(adherentsFile);
      setAdherentsResult(result);
    } catch (e) {
      setAdherentsError(String(e));
    } finally {
      setAdherentsBusy(false);
    }
  }

  if (!canImport) {
    return <p className="hint">Droits insuffisants — l'import est réservé aux rôles ADMIN et GESTIONNAIRE.</p>;
  }

  return (
    <div className="import-page">
      <section className="card">
        <h2>Campagne</h2>
        <div className="toolbar">
          {campagnes.length > 0 ? (
            <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
              {campagnes.map((c) => (
                <option key={c.id} value={c.id}>
                  Campagne {c.anneeScolaire} ({c._count.teacherSnapshots} enseignants)
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">Aucune campagne — créez-en une pour commencer.</span>
          )}
          <button type="button" className="secondary" onClick={() => setShowNewCampagne((v) => !v)}>
            {showNewCampagne ? "Annuler" : "Nouvelle campagne"}
          </button>
        </div>

        {showNewCampagne && (
          <form className="inline-form" onSubmit={createCampagne}>
            <label>
              Année scolaire
              <input
                required
                placeholder="2024-2025"
                value={newCampagne.anneeScolaire}
                onChange={(e) => setNewCampagne((s) => ({ ...s, anneeScolaire: e.target.value }))}
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
              <input
                required
                type="date"
                value={newCampagne.dateCcma}
                onChange={(e) => setNewCampagne((s) => ({ ...s, dateCcma: e.target.value }))}
              />
            </label>
            <button type="submit">Créer</button>
            {campagneError && <p className="error-text">{campagneError}</p>}
          </form>
        )}
      </section>

      <section className="card">
        <h2>Import rectorat (PDF)</h2>
        <p className="hint">
          Fichier "AVANCEMENT D'ECHELON" fourni par le rectorat (un fichier par grade). Le grade et l'échelon sont détectés
          automatiquement à partir du contenu du PDF — tu peux sélectionner les 5 fichiers d'une campagne en une fois, ils
          sont importés les uns après les autres.
        </p>
        <form className="inline-form" onSubmit={submitRectorat}>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={!campagneId}
            onChange={(e) => setRectoratFiles(Array.from(e.target.files ?? []))}
          />
          <button type="submit" disabled={!campagneId || rectoratFiles.length === 0 || rectoratBusy}>
            {rectoratBusy
              ? `Import en cours (${rectoratResults.length}/${rectoratFiles.length})...`
              : rectoratFiles.length > 1
                ? `Importer les ${rectoratFiles.length} fichiers`
                : "Importer"}
          </button>
        </form>
        {rectoratResults.length > 0 && (
          <div className="import-result">
            {rectoratResults.map((r, i) => (
              <div key={i} className={i > 0 ? "import-result-row" : undefined}>
                <p>
                  <strong>{r.fileName}</strong>
                  {r.result ? (
                    <>
                      {" "}
                      — <strong>{r.result.imported}</strong> fiches importées, grade détecté : <strong>{r.result.grade}</strong>
                    </>
                  ) : (
                    <span className="error-text"> — échec : {r.error}</span>
                  )}
                </p>
                {r.result && r.result.warnings.length > 0 && (
                  <details>
                    <summary>{r.result.warnings.length} avertissement(s)</summary>
                    <ul>
                      {r.result.warnings.map((w, j) => (
                        <li key={j}>
                          {w.nomUsage} {w.prenom} — {w.warnings.join("; ")}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Import adhérents (CSV)</h2>
        <p className="hint">
          Export ADEL des adhérents Spelc. Chaque adhérent est automatiquement rapproché des enseignants déjà importés
          (correspondance exacte ou approximative de nom/prénom) — les cas ambigus vont dans la file de révision.
        </p>
        <form className="inline-form" onSubmit={submitAdherents}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setAdherentsFile(e.target.files?.[0] ?? null)} />
          <button type="submit" disabled={!adherentsFile || adherentsBusy}>
            {adherentsBusy ? "Import en cours..." : "Importer"}
          </button>
        </form>
        {adherentsError && <p className="error-text">{adherentsError}</p>}
        {adherentsResult && (
          <div className="import-result">
            <p>
              <strong>{adherentsResult.created}</strong> créés, <strong>{adherentsResult.updated}</strong> mis à jour.
            </p>
            <p>
              Rapprochement : <strong>{adherentsResult.matching.autoConfirmed}</strong> automatique(s),{" "}
              <strong>{adherentsResult.matching.pendingReview}</strong> à vérifier dans la file de révision.
            </p>
            {adherentsResult.unmappedFields.length > 0 && (
              <p className="hint">Colonnes non reconnues dans le fichier : {adherentsResult.unmappedFields.join(", ")}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
