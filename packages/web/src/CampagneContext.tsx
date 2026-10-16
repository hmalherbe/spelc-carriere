import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Campagne } from "./api.js";

const STORAGE_KEY = "spelc_selected_annee_scolaire";
const COMMISSION_STORAGE_KEY = "spelc_selected_commission";

export type Commission = "CCMA" | "CCMI";

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
  /** Commissions (CCMA/CCMI) ayant au moins une campagne pour l'année scolaire sélectionnée. */
  commissionsDisponibles: Commission[];
  /** Choix global de commission (sélecteur d'en-tête) — piloté par useCampagneSelection pour
   * Dashboard/Mailing/Reliquats/Statistiques/Adhérents éligibles, qui partageaient auparavant
   * chacune leur propre sélection locale sans rapport les unes avec les autres : choisir CCMI sur
   * une page laissait les autres sur CCMA. Import, Hors classe/Classe exceptionnelle et la file de
   * révision n'en dépendent pas (leur propre sélection a un rôle différent — cibler un import, ou
   * mélanger les natures). */
  selectedCommission: Commission | null;
  setSelectedCommission: (commission: Commission) => void;
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
  const [selectedCommission, setSelectedCommissionState] = useState<Commission | null>(() => {
    const stored = localStorage.getItem(COMMISSION_STORAGE_KEY);
    return stored === "CCMA" || stored === "CCMI" ? stored : null;
  });
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
  const commissionsDisponibles = [...new Set(campagnesAnneeSelectionnee.map((c) => c.commission).filter((c): c is Commission => c != null))].sort();

  // Même garde-fou que pour l'année scolaire : une commission mémorisée (localStorage) ou choisie
  // sur une autre année scolaire peut ne plus exister pour celle-ci (ex. seule la CCMA a été créée
  // pour l'année en cours) — retombe sur la première disponible plutôt que de rester bloqué sur un
  // choix fantôme qui ferait disparaître silencieusement les données des 5 pages qui en dépendent.
  useEffect(() => {
    if (selectedCommission && commissionsDisponibles.includes(selectedCommission)) return;
    if (commissionsDisponibles.length > 0) setSelectedCommissionState(commissionsDisponibles[0]);
  }, [commissionsDisponibles.join("|")]);

  function setSelectedCommission(commission: Commission) {
    setSelectedCommissionState(commission);
    localStorage.setItem(COMMISSION_STORAGE_KEY, commission);
  }

  return (
    <CampagneContext.Provider
      value={{
        campagnes,
        anneesScolaires,
        selectedAnneeScolaire,
        setSelectedAnneeScolaire,
        campagnesAnneeSelectionnee,
        commissionsDisponibles,
        selectedCommission,
        setSelectedCommission,
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
 * Pour une page qui opère sur UNE campagne à la fois parmi les natures demandées (Dashboard,
 * Mailing, Reliquats, Statistiques, Adhérents éligibles : nature ECHELON) — restreint les candidats
 * à l'année scolaire globalement sélectionnée (sélecteur d'en-tête) et choisit celui qui correspond
 * à la commission globalement sélectionnée (sélecteur d'en-tête également, voir
 * CampagneContextValue.selectedCommission). Avant ce sélecteur de commission partagé, chaque page
 * gardait sa propre sélection locale indépendante : choisir CCMI sur une page n'avait aucun effet
 * sur les autres, qui restaient chacune sur leur propre choix (souvent incohérent d'une page à
 * l'autre). `setCampagneId` répercute donc le choix sur `selectedCommission` plutôt que de ne
 * retenir qu'un id local à cette page.
 */
export function useCampagneSelection(natures: Nature[]): {
  candidates: Campagne[];
  campagneId: string | null;
  setCampagneId: (id: string) => void;
} {
  const { campagnesAnneeSelectionnee, selectedCommission, setSelectedCommission } = useCampagneContext();
  const candidates = campagnesAnneeSelectionnee.filter((c) => c.nature != null && natures.includes(c.nature));

  const campagneId =
    (selectedCommission ? candidates.find((c) => c.commission === selectedCommission)?.id : undefined) ?? candidates[0]?.id ?? null;

  function setCampagneId(id: string) {
    const commission = candidates.find((c) => c.id === id)?.commission;
    if (commission) setSelectedCommission(commission);
  }

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
