import { useState } from "react";
import { api, type Campagne, type HcExcImportResult } from "../api.js";
import { useAuth } from "../AuthContext.js";
import { formatPrenom } from "../format.js";
import { AdherentImportSection } from "../components/AdherentImportSection.js";
import { HcExcCampagneCard } from "../components/HcExcCampagneCard.js";
import { SectionBanner, hcExcSectionLabel } from "../components/Layout.js";

function hcExcFilesOnly(files: File[]): File[] {
  return files.filter((f) => /\.(pdf|txt)$/i.test(f.name));
}

export function HcExcImportPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [selectedCampagne, setSelectedCampagne] = useState<Campagne | null>(null);
  const campagneId = selectedCampagne?.id ?? null;

  const [files, setFiles] = useState<File[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResults, setImportResults] = useState<{ fileName: string; result?: HcExcImportResult; error?: string }[]>([]);

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
  }

  return (
    <div className="import-page">
      <SectionBanner label={hcExcSectionLabel(selectedCampagne?.nature)} />
      <HcExcCampagneCard canEdit={canEdit} onSelect={setSelectedCampagne} />

      {canEdit && <AdherentImportSection campagneId={campagneId} commission={selectedCampagne?.commission ?? null} />}

      {selectedCampagne && canEdit && (
        <section className="card">
          <h2>Import tableau d'avancement (PDF ou texte)</h2>
          <p className="hint">
            Fichier "Tableau Avancement" fourni par le rectorat (un fichier par grade). Le grade et le processus sont
            détectés automatiquement à partir du contenu. Réimporter un fichier pour un grade déjà chargé dans cette
            campagne remplace entièrement les fiches précédentes.
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
    </div>
  );
}
