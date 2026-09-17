import { useEffect, useState } from "react";
import {
  api,
  type AcademicEmailImportResult,
  type AdelSyncLogEntry,
  type AdelSyncResult,
  type AdelSyncType,
  type AdherentImportResult,
  type Campagne,
  type RectoratImportResult,
} from "../api.js";
import { useAuth } from "../AuthContext.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSyncDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
}

function rectoratFilesOnly(files: File[]): File[] {
  return files.filter((f) => /\.(pdf|txt)$/i.test(f.name));
}

export function ImportPage() {
  const { user } = useAuth();
  const canImport = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [showNewCampagne, setShowNewCampagne] = useState(false);
  const [newCampagne, setNewCampagne] = useState<{ anneeScolaire: string; periodeDebut: string; periodeFin: string; dateCcma: string; type: "CCMA" | "CCMI" }>({
    anneeScolaire: "",
    periodeDebut: "",
    periodeFin: "",
    dateCcma: todayIso(),
    type: "CCMA",
  });
  const [campagneError, setCampagneError] = useState<string | null>(null);
  const [savingCampagneType, setSavingCampagneType] = useState(false);

  const selectedCampagne = campagnes.find((c) => c.id === campagneId) ?? null;

  const [rectoratFiles, setRectoratFiles] = useState<File[]>([]);
  const [rectoratBusy, setRectoratBusy] = useState(false);
  const [rectoratResults, setRectoratResults] = useState<{ fileName: string; result?: RectoratImportResult; error?: string }[]>([]);

  const [adelType, setAdelType] = useState<AdelSyncType>("CCMA");
  const [adelLast, setAdelLast] = useState<AdelSyncLogEntry | null>(null);
  const [adelBusy, setAdelBusy] = useState(false);
  const [adelResult, setAdelResult] = useState<AdelSyncResult | null>(null);
  const [adelError, setAdelError] = useState<string | null>(null);

  const [adherentFile, setAdherentFile] = useState<File | null>(null);
  const [adherentBusy, setAdherentBusy] = useState(false);
  const [adherentResult, setAdherentResult] = useState<AdherentImportResult | null>(null);
  const [adherentError, setAdherentError] = useState<string | null>(null);

  const [academicEmailFile, setAcademicEmailFile] = useState<File | null>(null);
  const [academicEmailBusy, setAcademicEmailBusy] = useState(false);
  const [academicEmailResult, setAcademicEmailResult] = useState<AcademicEmailImportResult | null>(null);
  const [academicEmailError, setAcademicEmailError] = useState<string | null>(null);

  function refreshAdelLast(type: AdelSyncType) {
    api.adelLastSync(type).then(setAdelLast).catch(() => setAdelLast(null));
  }

  useEffect(() => {
    refreshAdelLast(adelType);
  }, [adelType]);

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
      setNewCampagne({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "CCMA" });
      refreshCampagnes(created.id);
    } catch (e) {
      setCampagneError(String(e));
    }
  }

  async function changeCampagneType(type: "CCMA" | "CCMI") {
    if (!campagneId) return;
    setSavingCampagneType(true);
    setCampagneError(null);
    try {
      await api.updateCampagneType(campagneId, type);
      refreshCampagnes(campagneId);
    } catch (e) {
      setCampagneError(String(e));
    } finally {
      setSavingCampagneType(false);
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

  async function syncAdel() {
    setAdelBusy(true);
    setAdelError(null);
    setAdelResult(null);
    try {
      const result = await api.adelSync(adelType);
      setAdelResult(result);
      refreshAdelLast(adelType);
    } catch (e) {
      setAdelError(String(e));
    } finally {
      setAdelBusy(false);
    }
  }

  async function submitAdherentFile(e: React.FormEvent) {
    e.preventDefault();
    if (!adherentFile) return;
    setAdherentBusy(true);
    setAdherentError(null);
    setAdherentResult(null);
    try {
      const result = await api.importAdherents(adherentFile);
      setAdherentResult(result);
      setAdherentFile(null);
    } catch (e) {
      setAdherentError(String(e));
    } finally {
      setAdherentBusy(false);
    }
  }

  async function submitAcademicEmailFile(e: React.FormEvent) {
    e.preventDefault();
    if (!academicEmailFile) return;
    setAcademicEmailBusy(true);
    setAcademicEmailError(null);
    setAcademicEmailResult(null);
    try {
      const result = await api.importAcademicEmails(academicEmailFile);
      setAcademicEmailResult(result);
      setAcademicEmailFile(null);
    } catch (e) {
      setAcademicEmailError(String(e));
    } finally {
      setAcademicEmailBusy(false);
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
                  {c.type ?? "?"} {c.anneeScolaire} ({c._count.teacherSnapshots} enseignants)
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">Aucune campagne — créez-en une pour commencer.</span>
          )}
          {selectedCampagne && (
            <label>
              Commission de cette campagne
              <select
                value={selectedCampagne.type ?? ""}
                onChange={(e) => changeCampagneType(e.target.value as "CCMA" | "CCMI")}
                disabled={savingCampagneType}
              >
                {!selectedCampagne.type && <option value="">— à définir —</option>}
                <option value="CCMA">CCMA (second degré)</option>
                <option value="CCMI">CCMI (premier degré)</option>
              </select>
            </label>
          )}
          <label>
            Type de synchronisation ADEL
            <select value={adelType} onChange={(e) => setAdelType(e.target.value as AdelSyncType)} disabled={adelBusy}>
              <option value="CCMA">CCMA (second degré)</option>
              <option value="CCMI">CCMI (premier degré)</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => setShowNewCampagne((v) => !v)}>
            {showNewCampagne ? "Annuler" : "Nouvelle campagne"}
          </button>
        </div>
        <p className="hint">
          La commission (CCMA ou CCMI) détermine quels élus (page Élus CCMA/CCMI) apparaissent dans les mailings
          envoyés pour cette campagne.
        </p>

        {showNewCampagne && (
          <form className="inline-form" onSubmit={createCampagne}>
            <label>
              Commission
              <select value={newCampagne.type} onChange={(e) => setNewCampagne((s) => ({ ...s, type: e.target.value as "CCMA" | "CCMI" }))}>
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
        <h2>Import rectorat (PDF ou texte)</h2>
        <p className="hint">
          Fichier "AVANCEMENT D'ECHELON" fourni par le rectorat (un fichier par grade), en PDF ou déjà en texte brut (.txt —
          par exemple un copié-collé depuis un lecteur PDF). Le grade et l'échelon sont détectés automatiquement à partir du
          contenu — tu peux sélectionner les 5 fichiers d'une campagne en une fois, ou choisir directement le dossier qui les
          contient (les fichiers d'un autre format sont ignorés). Ils sont importés les uns après les autres.
        </p>
        <form className="inline-form" onSubmit={submitRectorat}>
          <label>
            Fichiers
            <input
              type="file"
              accept="application/pdf,.pdf,.txt"
              multiple
              disabled={!campagneId}
              onChange={(e) => setRectoratFiles(rectoratFilesOnly(Array.from(e.target.files ?? [])))}
            />
          </label>
          <label>
            ou un dossier
            <input
              type="file"
              disabled={!campagneId}
              ref={(el) => {
                if (el) {
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                }
              }}
              onChange={(e) => setRectoratFiles(rectoratFilesOnly(Array.from(e.target.files ?? [])))}
            />
          </label>
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
                  {r.error && <span className="error-text"> — échec : {r.error}</span>}
                </p>
                {r.result &&
                  r.result.results.map((g, j) => (
                    <div key={j} className={g.error ? undefined : "import-result-grade"}>
                      {g.error ? (
                        <p className="error-text"> — {g.error}</p>
                      ) : (
                        <>
                          <p>
                            {" "}
                            — <strong>{g.imported}</strong> fiches importées, grade détecté : <strong>{g.grade}</strong>
                          </p>
                          {g.warnings.length > 0 && (
                            <details>
                              <summary>{g.warnings.length} avertissement(s)</summary>
                              <ul>
                                {g.warnings.map((w, k) => (
                                  <li key={k}>
                                    {w.nomUsage} {w.prenom} — {w.warnings.join("; ")}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Import adhérents — mise à jour ADEL</h2>
        <p className="hint">
          Récupère automatiquement l'export des adhérents Spelc directement depuis ADEL (connexion, filtre "azur", export
          Excel) — plus besoin d'exporter puis d'uploader un fichier à la main. Chaque adhérent est automatiquement
          rapproché des enseignants déjà importés (correspondance exacte ou approximative de nom/prénom) — les cas ambigus
          vont dans la file de révision.
        </p>
        <div className="inline-form">
          <button type="button" onClick={syncAdel} disabled={adelBusy}>
            {adelBusy ? "Synchronisation en cours (peut prendre plusieurs minutes)..." : "Mettre à jour depuis ADEL"}
          </button>
        </div>
        <p className="hint">
          {adelLast ? (
            adelLast.status === "SUCCESS" ? (
              <>Dernière mise à jour : {formatSyncDate(adelLast.syncedAt)}</>
            ) : (
              <span className="error-text">Dernière tentative en échec le {formatSyncDate(adelLast.syncedAt)}</span>
            )
          ) : (
            "Jamais synchronisé pour ce type de campagne."
          )}
        </p>
        {adelError && <p className="error-text">{adelError}</p>}
        {adelResult && (
          <div className="import-result">
            <p>
              <strong>{adelResult.created}</strong> créés, <strong>{adelResult.updated}</strong> mis à jour.
            </p>
            <p>
              Rapprochement : <strong>{adelResult.matching.autoConfirmed}</strong> automatique(s),{" "}
              <strong>{adelResult.matching.pendingReview}</strong> à vérifier dans la file de révision.
            </p>
            {adelResult.unmappedFields.length > 0 && (
              <p className="hint">Colonnes non reconnues dans l'export : {adelResult.unmappedFields.join(", ")}</p>
            )}
          </div>
        )}

        <p className="hint" style={{ marginTop: 16 }}>
          En secours si la synchronisation automatique ne fonctionne pas : exporte l'annuaire des adhérents à la main
          depuis ADEL (Excel ou CSV), puis dépose le fichier ici — même moteur de rapprochement que la synchronisation
          automatique.
        </p>
        <form className="inline-form" onSubmit={submitAdherentFile}>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setAdherentFile(e.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={!adherentFile || adherentBusy}>
            {adherentBusy ? "Import en cours..." : "Importer le fichier"}
          </button>
        </form>
        {adherentError && <p className="error-text">{adherentError}</p>}
        {adherentResult && (
          <div className="import-result">
            <p>
              <strong>{adherentResult.created}</strong> créés, <strong>{adherentResult.updated}</strong> mis à jour.
            </p>
            <p>
              Rapprochement : <strong>{adherentResult.matching.autoConfirmed}</strong> automatique(s),{" "}
              <strong>{adherentResult.matching.pendingReview}</strong> à vérifier dans la file de révision.
            </p>
            {adherentResult.unmappedFields.length > 0 && (
              <p className="hint">Colonnes non reconnues dans le fichier : {adherentResult.unmappedFields.join(", ")}</p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Emails académiques (non-adhérents)</h2>
        <p className="hint">
          Un adhérent est notifié à son adresse personnelle. Un non-adhérent n'en a pas — c'est ce fichier (l'annuaire du
          personnel de l'académie : Nom, Prénom, Adresse mail) qui permet de le joindre à la place, par recherche sur son
          nom et prénom. Sans correspondance dans ce fichier, aucun envoi n'est possible pour cette personne, faute
          d'adresse connue. Chaque import remplace entièrement le précédent.
        </p>
        <form className="inline-form" onSubmit={submitAcademicEmailFile}>
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => setAcademicEmailFile(e.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={!academicEmailFile || academicEmailBusy}>
            {academicEmailBusy ? "Import en cours..." : "Importer le fichier"}
          </button>
        </form>
        {academicEmailError && <p className="error-text">{academicEmailError}</p>}
        {academicEmailResult && (
          <div className="import-result">
            <p>
              <strong>{academicEmailResult.imported}</strong> adresses importées.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
