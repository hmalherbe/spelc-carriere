import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Campagne } from "./api.js";

const STORAGE_KEY = "spelc_selected_annee_scolaire";

interface CampagneContextValue {
  /** Toutes les campagnes, toutes années scolaires confondues. */
  campagnes: Campagne[];
  /** Années scolaires présentes, les plus récentes d'abord ("2025-2026" trie bien avant
   * "2024-2025" en ordre alphabétique inverse — pas besoin de parser les dates). */
  anneesScolaires: string[];
  selectedAnneeScolaire: string | null;
  setSelectedAnneeScolaire: (anneeScolaire: string) => void;
  /** Sous-ensemble de `campagnes` pour l'année scolaire sélectionnée — jusqu'à 6, une par
   * (commission, nature), voir ANNEE_SCOLAIRE_SLOTS côté API. */
  campagnesAnneeSelectionnee: Campagne[];
  loading: boolean;
  error: string | null;
  /** À rappeler après toute création/suppression de campagne ailleurs dans l'appli (ImportPage,
   * HorsClasseExceptionnellePage...) pour que le sélecteur d'en-tête reste à jour. */
  refresh: () => Promise<void>;
}

const CampagneContext = createContext<CampagneContextValue | undefined>(undefined);

export function CampagneProvider({ children }: { children: ReactNode }) {
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [selectedAnneeScolaire, setSelectedAnneeScolaireState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.campagnes();
      setCampagnes(c);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const anneesScolaires = [...new Set(campagnes.map((c) => c.anneeScolaire))].sort((a, b) => b.localeCompare(a));

  // L'année scolaire mémorisée (localStorage) peut ne plus exister (serveur réinitialisé, autre
  // poste) — retombe alors sur la plus récente disponible, jamais sur une sélection fantôme.
  useEffect(() => {
    if (selectedAnneeScolaire && anneesScolaires.includes(selectedAnneeScolaire)) return;
    if (anneesScolaires.length > 0) setSelectedAnneeScolaireState(anneesScolaires[0]);
    // Keyed on the joined string, not the array itself: `anneesScolaires` is a brand new array on
    // every render (derived from `campagnes`), which would otherwise re-run this effect every time.
  }, [anneesScolaires.join("|")]);

  function setSelectedAnneeScolaire(anneeScolaire: string) {
    setSelectedAnneeScolaireState(anneeScolaire);
    localStorage.setItem(STORAGE_KEY, anneeScolaire);
  }

  const campagnesAnneeSelectionnee = campagnes.filter((c) => c.anneeScolaire === selectedAnneeScolaire);

  return (
    <CampagneContext.Provider
      value={{
        campagnes,
        anneesScolaires,
        selectedAnneeScolaire,
        setSelectedAnneeScolaire,
        campagnesAnneeSelectionnee,
        loading,
        error,
        refresh,
      }}
    >
      {children}
    </CampagneContext.Provider>
  );
}

export function useCampagneContext(): CampagneContextValue {
  const ctx = useContext(CampagneContext);
  if (!ctx) throw new Error("useCampagneContext must be used within CampagneProvider");
  return ctx;
}

export type Nature = "ECHELON" | "HC" | "EXC";

/**
 * Pour une page qui opère sur UNE campagne à la fois (Dashboard/Mailing/Reliquats/Stats/Import :
 * nature ECHELON ; HorsClasseExceptionnellePage : HC et/ou EXC) — restreint les candidats à
 * l'année scolaire globalement sélectionnée (sélecteur d'en-tête) et aux natures demandées, au lieu
 * de la liste complète de campagnes toutes années confondues que chaque page gérait indépendamment
 * jusqu'ici. Garde une sélection locale par commission (CCMA/CCMI) quand plusieurs candidats
 * existent pour cette année scolaire — ex. une campagne CCMA et une campagne CCMI d'avancement
 * d'échelon coexistent presque toujours, voir ANNEE_SCOLAIRE_SLOTS côté API.
 */
export function useCampagneSelection(natures: Nature[]): {
  candidates: Campagne[];
  campagneId: string | null;
  setCampagneId: (id: string) => void;
} {
  const { campagnesAnneeSelectionnee } = useCampagneContext();
  const candidates = campagnesAnneeSelectionnee.filter((c) => c.nature != null && natures.includes(c.nature));
  const [campagneId, setCampagneId] = useState<string | null>(null);

  useEffect(() => {
    if (candidates.some((c) => c.id === campagneId)) return;
    setCampagneId(candidates[0]?.id ?? null);
    // Gardé sur la liste jointe des id, pas sur le tableau lui-même : `candidates` est un nouveau
    // tableau à chaque rendu (dérivé du contexte) — ne doit se redéclencher que si l'ENSEMBLE des id
    // change réellement (nouvelle année scolaire sélectionnée, campagne créée/supprimée).
  }, [candidates.map((c) => c.id).join("|")]);

  return { candidates, campagneId, setCampagneId };
}

/** Libellé court pour un candidat de useCampagneSelection — la commission seule suffit quand une
 * seule nature est demandée (ex. "CCMA"), les deux axes sinon (ex. "CCMA · HC", "CCMI · Échelon"). */
export function labelForCampagneCandidate(c: Campagne, naturesCount: number): string {
  const commission = c.commission ?? c.type ?? "?";
  if (naturesCount <= 1) return commission;
  const natureLabel = c.nature === "HC" ? "HC" : c.nature === "EXC" ? "EXC" : c.nature === "ECHELON" ? "Échelon" : (c.type ?? "?");
  return `${commission} · ${natureLabel}`;
}
