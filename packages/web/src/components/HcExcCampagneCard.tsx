import { useEffect, useState } from "react";
import { api, type Campagne } from "../api.js";
import { useCampagneContext, labelForCampagneCandidate } from "../CampagneContext.js";
import { derivePeriodeFromAnneeScolaire } from "../format.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateCommissionLabel(commission: "CCMA" | "CCMI"): string {
  return commission === "CCMI" ? "Date CCMI" : "Date CCMA";
}

/**
 * Sélection/création de campagne HC/EXC — commun aux pages "Import" (HcExcImportPage.tsx) et
 * "Enseignants promouvables" (HorsClasseExceptionnellePage.tsx), extrait pour que les deux onglets
 * restent synchronisés sans dupliquer cette logique. Contrairement au sélecteur de commission
 * global (CCMA/CCMI, en-tête), celui-ci reste local à ce composant : il doit aussi distinguer HC
 * de EXC, ce que le sélecteur global ne fait pas, et chaque onglet peut vouloir cibler une
 * campagne précise indépendamment de l'autre (même pattern que ImportPage.tsx pour l'échelon).
 *
 * `onSelect` est appelé à chaque changement de sélection (y compris au montage et après création)
 * avec la campagne résolue ou null — c'est au composant parent de garder cette valeur pour piloter
 * le reste de sa page (import, résultats...).
 */
export function HcExcCampagneCard({ canEdit, onSelect }: { canEdit: boolean; onSelect: (campagne: Campagne | null) => void }) {
  const { campagnesAnneeSelectionnee, refresh: refreshContextCampagnes, setSelectedAnneeScolaire } = useCampagneContext();
  const hcExcCampagnes = campagnesAnneeSelectionnee.filter((c) => c.nature === "HC" || c.nature === "EXC");
  const [campagneId, setCampagneId] = useState<string | null>(null);

  useEffect(() => {
    if (hcExcCampagnes.some((c) => c.id === campagneId)) return;
    setCampagneId(hcExcCampagnes[0]?.id ?? null);
    // Gardé sur la liste jointe des id : `hcExcCampagnes` est un nouveau tableau à chaque rendu
    // (dérivé du contexte) — ne doit se redéclencher que si l'ENSEMBLE des id change réellement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hcExcCampagnes.map((c) => c.id).join("|")]);

  const selectedCampagne = hcExcCampagnes.find((c) => c.id === campagneId) ?? null;

  useEffect(() => {
    onSelect(selectedCampagne);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampagne?.id]);

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
      await refreshContextCampagnes();
      setCampagneId(created.id);
    } catch (e) {
      setCampagneError(String(e));
    }
  }

  return (
    <section className="card">
      <h2>Hors classe / Classe exceptionnelle</h2>
      <p className="hint">
        Suivi des passages à la hors-classe et à la classe exceptionnelle — import du tableau d'avancement du rectorat
        (barème et rang), rapprochement adhérents, et décision de promotion ligne à ligne (le marqueur "Choix du Recteur"
        du fichier rectorat, modifiable depuis l'onglet Mailing).
      </p>
      <div className="toolbar">
        {hcExcCampagnes.length > 0 ? (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {hcExcCampagnes.map((c) => (
              <option key={c.id} value={c.id}>
                {labelForCampagneCandidate(c, 2)} ({c._count.hcExcSnapshots} enseignants)
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
  );
}
