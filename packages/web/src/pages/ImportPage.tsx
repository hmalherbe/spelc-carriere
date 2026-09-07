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

  const [rectoratFile, setRectoratFile] = useState<File | null>(null);
  const [rectoratBusy, setRectoratBusy] = useState(false);
  const [rectoratResult, setRectoratResult] = useState<RectoratImportResult | null>(null);
  const [rectoratError, setRectoratError] = useState<string | null>(null);

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
    if (!campagneId || !rectoratFile) return;
    setRectoratBusy(true);
    setRectoratError(null);
    setRectoratResult(null);
    try {
      const result = await api.importRectorat(campagneId, rectoratFile);
      setRectoratResult(result);
      refreshCampagnes(campagneId);
    } catch (e) {
      setRectoratError(String(e));
    } finally {
      setRectoratBusy(false);
    }
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
          automatiquement à partir du contenu du PDF.
        </p>
        <form className="inline-form" onSubmit={submitRectorat}>
          <input
            type="file"
            accept="application/pdf"
            disabled={!campagneId}
            onChange={(e) => setRectoratFile(e.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={!campagneId || !rectoratFile || rectoratBusy}>
            {rectoratBusy ? "Import en cours..." : "Importer"}
          </button>
        </form>
        {rectoratError && <p className="error-text">{rectoratError}</p>}
        {rectoratResult && (
          <div className="import-result">
            <p>
              <strong>{rectoratResult.imported}</strong> fiches importées — grade détecté : <strong>{rectoratResult.grade}</strong>
            </p>
            {rectoratResult.warnings.length > 0 && (
              <details>
                <summary>{rectoratResult.warnings.length} avertissement(s)</summary>
                <ul>
                  {rectoratResult.warnings.map((w, i) => (
                    <li key={i}>
                      {w.nomUsage} {w.prenom} — {w.warnings.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
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
