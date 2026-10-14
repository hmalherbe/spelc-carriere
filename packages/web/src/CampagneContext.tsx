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
