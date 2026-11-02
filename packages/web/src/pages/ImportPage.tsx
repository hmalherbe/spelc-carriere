import { useEffect, useState } from "react";
import { api, type Campagne, type RectoratImportResult } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { useCampagneContext, labelForCampagneCandidate } from "../CampagneContext.js";
import { formatPrenom, derivePeriodeFromAnneeScolaire } from "../format.js";
import { AdherentImportSection } from "../components/AdherentImportSection.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateCommissionLabel(type: Campagne["type"]): string {
  return type === "CCMI" ? "Date CCMI" : "Date CCMA";
}

function rectoratFilesOnly(files: File[]): File[] {
  return files.filter((f) => /\.(pdf|txt)$/i.test(f.name));
}

export function ImportPage() {
  const { user } = useAuth();
  const canImport = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  // Cette page (avancement d'échelon) ne concerne que CCMA/CCMI — les campagnes Hors Classe/Classe
  // Exceptionnelle ont leur propre page (HorsClasseExceptionnellePage) et leur propre sélecteur.
  // Une campagne sans nature (créée avant l'ajout de ce champ) reste visible ici : c'est cette page
  // qui offre de définir sa commission CCMA/CCMI, ci-dessous.
  const { campagnesAnneeSelectionnee, refresh: refreshContextCampagnes, setSelectedAnneeScolaire } = useCampagneContext();
  const campagnes = campagnesAnneeSelectionnee.filter((c) => c.nature === "ECHELON" || c.nature == null);
  const [campagneId, setCampagneId] = useState<string | null>(null);

  useEffect(() => {
    if (campagnes.some((c) => c.id === campagneId)) return;
    setCampagneId(campagnes[0]?.id ?? null);
    // Gardé sur la liste jointe des id : `campagnes` est un nouveau tableau à chaque rendu (dérivé
    // du contexte) — ne doit se redéclencher que si l'ENSEMBLE des id change réellement.
  }, [campagnes.map((c) => c.id).join("|")]);

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

  const [showEditDates, setShowEditDates] = useState(false);
  const [editDates, setEditDates] = useState({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: "" });
  const [savingDates, setSavingDates] = useState(false);
  const [deletingCampagne, setDeletingCampagne] = useState(false);
  const [deleteCampagneError, setDeleteCampagneError] = useState<string | null>(null);

  // Repopule le formulaire d'édition sur la campagne réellement sélectionnée à chaque ouverture —
  // sinon il garderait les valeurs d'une précédente ouverture si l'utilisateur change de campagne
  // entre-temps sans jamais rouvrir le formulaire.
  useEffect(() => {
    if (showEditDates && selectedCampagne) {
      setEditDates({
        anneeScolaire: selectedCampagne.anneeScolaire,
        periodeDebut: selectedCampagne.periodeDebut.slice(0, 10),
        periodeFin: selectedCampagne.periodeFin.slice(0, 10),
        dateCcma: selectedCampagne.dateCcma.slice(0, 10),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditDates, selectedCampagne?.id]);

  const [rectoratFiles, setRectoratFiles] = useState<File[]>([]);
  const [rectoratBusy, setRectoratBusy] = useState(false);
  const [rectoratResults, setRectoratResults] = useState<{ fileName: string; result?: RectoratImportResult; error?: string }[]>([]);

  /** Rafraîchit la liste via le contexte global (partagé avec le sélecteur d'en-tête et toutes les
   * autres pages) plutôt que de refetcher indépendamment. `selectId` force la sélection d'une
   * campagne qui vient d'être créée — nécessaire ici (jamais pour une campagne déjà sélectionnée
   * dont on vient juste de changer le type/les dates) car l'effet d'auto-sélection ci-dessus ne
   * choisit que le PREMIER candidat quand l'actuel disparaît, pas un id précis. */
  async function refreshCampagnes(selectId?: string) {
    await refreshContextCampagnes();
    if (selectId) setCampagneId(selectId);
  }

  async function createCampagne(e: React.FormEvent) {
    e.preventDefault();
    setCampagneError(null);
    try {
      const created = await api.createCampagne(newCampagne);
      setShowNewCampagne(false);
      setNewCampagne({ anneeScolaire: "", periodeDebut: "", periodeFin: "", dateCcma: todayIso(), type: "CCMA" });
      // La nouvelle campagne peut appartenir à une année scolaire différente de celle actuellement
      // sélectionnée en en-tête — sans ça, `campagnes` (filtré sur l'année sélectionnée) ne la
      // contiendrait pas et `created.id` ne correspondrait à aucune option du sélecteur ci-dessous.
      setSelectedAnneeScolaire(created.anneeScolaire);
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

  async function saveDates(e: React.FormEvent) {
    e.preventDefault();
    if (!campagneId) return;
    setSavingDates(true);
    setCampagneError(null);
    try {
      await api.updateCampagne(campagneId, editDates);
      setShowEditDates(false);
      refreshCampagnes(campagneId);
    } catch (e) {
      setCampagneError(String(e));
    } finally {
      setSavingDates(false);
    }
  }

  async function deleteCampagne() {
    if (!selectedCampagne) return;
    const label = `${selectedCampagne.type ?? "?"} ${selectedCampagne.anneeScolaire}`;
    const confirmed = window.confirm(
      `Supprimer définitivement la campagne "${label}" ?\n\n` +
        `Toutes les données liées à cette campagne seront supprimées : les ${selectedCampagne._count.teacherSnapshots} enseignant(s) importé(s), ` +
        `les ${selectedCampagne._count.imports} fichier(s) rectorat importé(s), les promotions calculées, les reliquats et ` +
        `l'historique d'envois de mailing de cette campagne.\n\n` +
        `Cette action est irréversible.`,
    );
    if (!confirmed) return;
    setDeletingCampagne(true);
    setDeleteCampagneError(null);
    try {
      await api.deleteCampagne(selectedCampagne.id);
      // Désélectionne tout de suite plutôt que d'attendre le round-trip de refreshContextCampagnes :
      // sinon la campagne qui vient d'être supprimée resterait affichée comme sélectionnée pendant
      // ce court intervalle. L'effet d'auto-sélection ci-dessus reprend la main une fois `campagnes`
      // mis à jour (un autre candidat de cette année scolaire, ou aucun).
      setCampagneId(null);
      await refreshContextCampagnes();
    } catch (e) {
      setDeleteCampagneError(String(e));
    } finally {
      setDeletingCampagne(false);
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
                  {labelForCampagneCandidate(c, 1)} ({c._count.teacherSnapshots} enseignants)
                </option>
              ))}
            </select>
          ) : (
            <span className="hint">
              Aucune campagne d'avancement d'échelon pour l'année scolaire sélectionnée — créez-en une ci-dessous, ou
              changez d'année scolaire dans l'en-tête.
            </span>
          )}
          <button type="button" className="secondary" onClick={() => setShowNewCampagne((v) => !v)}>
            {showNewCampagne ? "Annuler" : "Nouvelle campagne"}
          </button>
          {selectedCampagne && (
            <button type="button" className="secondary" onClick={() => setShowEditDates((v) => !v)}>
              {showEditDates ? "Annuler" : "Modifier les dates"}
            </button>
          )}
          {selectedCampagne && (
            <button type="button" className="secondary" onClick={deleteCampagne} disabled={deletingCampagne}>
              {deletingCampagne ? "Suppression..." : "Supprimer la campagne"}
            </button>
          )}
        </div>
        {deleteCampagneError && <p className="error-text">{deleteCampagneError}</p>}

        {showEditDates && selectedCampagne && (
          <form className="inline-form" onSubmit={saveDates}>
            <label>
              Année scolaire
              <input
                required
                value={editDates.anneeScolaire}
                onChange={(e) => setEditDates((s) => ({ ...s, anneeScolaire: e.target.value }))}
              />
            </label>
            <label>
              Début de période
              <input
                required
                type="date"
                value={editDates.periodeDebut}
                onChange={(e) => setEditDates((s) => ({ ...s, periodeDebut: e.target.value }))}
              />
            </label>
            <label>
              Fin de période
              <input
                required
                type="date"
                value={editDates.periodeFin}
                onChange={(e) => setEditDates((s) => ({ ...s, periodeFin: e.target.value }))}
              />
            </label>
            <label>
              {dateCommissionLabel(selectedCampagne.type)}
              <input required type="date" value={editDates.dateCcma} onChange={(e) => setEditDates((s) => ({ ...s, dateCcma: e.target.value }))} />
            </label>
            <button type="submit" disabled={savingDates}>
              {savingDates ? "Enregistrement..." : "Enregistrer"}
            </button>
            {campagneError && <p className="error-text">{campagneError}</p>}
          </form>
        )}

        {selectedCampagne && !selectedCampagne.type && (
          <p className="hint error-text">
            Cette campagne a été créée avant l'ajout de la commission CCMA/CCMI et n'en a pas —{" "}
            <select
              value=""
              onChange={(e) => changeCampagneType(e.target.value as "CCMA" | "CCMI")}
              disabled={savingCampagneType}
              style={{ display: "inline-block", width: "auto" }}
            >
              <option value="" disabled>
                définir maintenant...
              </option>
              <option value="CCMA">CCMA (second degré)</option>
              <option value="CCMI">CCMI (premier degré)</option>
            </select>{" "}
            — sinon ni ses élus ni sa synchronisation ADEL ne fonctionneront.
          </p>
        )}

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
              {dateCommissionLabel(newCampagne.type)}
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
                                    {w.nomUsage} {formatPrenom(w.prenom)} — {w.warnings.join("; ")}
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

      <AdherentImportSection
        campagneId={campagneId}
        commission={selectedCampagne?.type === "CCMA" || selectedCampagne?.type === "CCMI" ? selectedCampagne.type : null}
      />
    </div>
  );
}
