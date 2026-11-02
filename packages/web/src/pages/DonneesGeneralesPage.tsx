import { useState } from "react";
import { api, type AcademicEmailImportResult } from "../api.js";
import { useAuth } from "../AuthContext.js";

export function DonneesGeneralesPage() {
  const { user } = useAuth();
  const canImport = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [academicEmailFile, setAcademicEmailFile] = useState<File | null>(null);
  const [academicEmailBusy, setAcademicEmailBusy] = useState(false);
  const [academicEmailResult, setAcademicEmailResult] = useState<AcademicEmailImportResult | null>(null);
  const [academicEmailError, setAcademicEmailError] = useState<string | null>(null);

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
        <h2>Emails académiques (non-adhérents)</h2>
        <p className="hint">
          Un adhérent est notifié à son adresse personnelle. Un non-adhérent n'en a pas — c'est ce fichier (l'annuaire du
          personnel de l'académie : Nom, Prénom, Adresse mail) qui permet de le joindre à la place, par recherche sur son
          nom et prénom. Sans correspondance dans ce fichier, aucun envoi n'est possible pour cette personne, faute
          d'adresse connue. Chaque import remplace entièrement le précédent. Commun à tous les processus (avancement,
          hors classe/classe exceptionnelle, mouvement) — un seul import pour toute l'application.
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
