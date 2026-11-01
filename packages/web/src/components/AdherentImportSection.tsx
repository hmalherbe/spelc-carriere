import { useEffect, useState } from "react";
import { api, type AdelSyncLogEntry, type AdelSyncResult, type AdelSyncType, type AdherentImportResult } from "../api.js";

function formatSyncDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
}

/**
 * Import des adhérents (synchronisation ADEL automatique + repli manuel Excel/CSV) — commun à
 * TOUTES les campagnes (échelon, Hors classe, Classe exceptionnelle) puisque les adhérents
 * eux-mêmes ne sont pas scopés par nature (voir Adherent dans schema.prisma) : extrait de
 * ImportPage.tsx pour être réutilisé à l'identique depuis HorsClasseExceptionnellePage.tsx, plutôt
 * que de le dupliquer ou de forcer un passage par la page Import de l'avancement d'échelon.
 *
 * `commission` (pas `campagne.type`, qui vaut "HC"/"EXC" pour ces campagnes-là) pilote quelle
 * synchronisation ADEL regarder/déclencher (1er ou 2nd degré) — voir Campagne.commission's own doc
 * comment dans api.ts.
 */
export function AdherentImportSection({ campagneId, commission }: { campagneId: string | null; commission: "CCMA" | "CCMI" | null }) {
  const [adelLast, setAdelLast] = useState<AdelSyncLogEntry | null>(null);
  const [adelBusy, setAdelBusy] = useState(false);
  const [adelResult, setAdelResult] = useState<AdelSyncResult | null>(null);
  const [adelError, setAdelError] = useState<string | null>(null);

  const [adherentFile, setAdherentFile] = useState<File | null>(null);
  const [adherentBusy, setAdherentBusy] = useState(false);
  const [adherentResult, setAdherentResult] = useState<AdherentImportResult | null>(null);
  const [adherentError, setAdherentError] = useState<string | null>(null);

  function refreshAdelLast(type: AdelSyncType) {
    api.adelLastSync(type).then(setAdelLast).catch(() => setAdelLast(null));
  }

  useEffect(() => {
    if (commission === "CCMA" || commission === "CCMI") refreshAdelLast(commission);
    else setAdelLast(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commission]);

  async function syncAdel() {
    if ((commission !== "CCMA" && commission !== "CCMI") || !campagneId) return;
    setAdelBusy(true);
    setAdelError(null);
    setAdelResult(null);
    try {
      const result = await api.adelSync(commission, campagneId);
      setAdelResult(result);
      refreshAdelLast(commission);
    } catch (e) {
      setAdelError(String(e));
    } finally {
      setAdelBusy(false);
    }
  }

  async function submitAdherentFile(e: React.FormEvent) {
    e.preventDefault();
    if (!adherentFile || !campagneId) return;
    setAdherentBusy(true);
    setAdherentError(null);
    setAdherentResult(null);
    try {
      const result = await api.importAdherents(adherentFile, campagneId);
      setAdherentResult(result);
      setAdherentFile(null);
    } catch (e) {
      setAdherentError(String(e));
    } finally {
      setAdherentBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Import adhérents — mise à jour ADEL</h2>
      <p className="hint">
        Récupère automatiquement l'export des adhérents Spelc directement depuis ADEL (connexion, filtre "azur", export
        Excel) — plus besoin d'exporter puis d'uploader un fichier à la main. Chaque adhérent est automatiquement
        rapproché des enseignants déjà importés (correspondance exacte ou approximative de nom/prénom) — les cas ambigus
        vont dans la file de révision. Le fichier récupéré (1er ou 2nd degré) suit la commission de la campagne
        sélectionnée ci-dessus.
      </p>
      <div className="inline-form">
        <button type="button" onClick={syncAdel} disabled={adelBusy || !campagneId || !commission}>
          {adelBusy ? "Synchronisation en cours (peut prendre plusieurs minutes)..." : "Mettre à jour depuis ADEL"}
        </button>
      </div>
      {!commission && <p className="hint">Sélectionnez une campagne dont la commission (CCMA/CCMI) est définie pour synchroniser.</p>}
      <p className="hint">
        {adelLast ? (
          adelLast.status === "SUCCESS" ? (
            <>Dernière mise à jour : {formatSyncDate(adelLast.syncedAt)}</>
          ) : (
            <span className="error-text">Dernière tentative en échec le {formatSyncDate(adelLast.syncedAt)}</span>
          )
        ) : (
          commission && "Jamais synchronisé pour cette commission."
        )}
      </p>
      {adelError && <p className="error-text">{adelError}</p>}
      {adelResult && (
        <div className="import-result">
          <p>
            <strong>{adelResult.created}</strong> créés, <strong>{adelResult.updated}</strong> mis à jour
            {adelResult.deleted > 0 && (
              <>
                , <strong>{adelResult.deleted}</strong> supprimé(s) (ne font plus partie de l'export — parti(e)s du
                syndicat)
              </>
            )}
            .
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
        <input type="file" accept=".csv,.xlsx" disabled={!campagneId} onChange={(e) => setAdherentFile(e.target.files?.[0] ?? null)} />
        <button type="submit" disabled={!adherentFile || !campagneId || adherentBusy}>
          {adherentBusy ? "Import en cours..." : "Importer le fichier"}
        </button>
      </form>
      {adherentError && <p className="error-text">{adherentError}</p>}
      {adherentResult && (
        <div className="import-result">
          <p>
            <strong>{adherentResult.created}</strong> créés, <strong>{adherentResult.updated}</strong> mis à jour
            {adherentResult.deleted > 0 && (
              <>
                , <strong>{adherentResult.deleted}</strong> supprimé(s) (ne font plus partie du fichier — parti(e)s du
                syndicat)
              </>
            )}
            .
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
  );
}
