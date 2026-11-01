import { useEffect, useState } from "react";
import { type Campagne } from "./api.js";
import { useCampagneContext } from "./CampagneContext.js";

/**
 * Sélection locale d'une campagne HC/EXC, INDÉPENDANTE du sélecteur de commission global
 * (CCMA/CCMI, en-tête) — nécessaire parce que `useCampagneSelection` (CampagneContext.tsx) ne
 * retient que la commission choisie, pas la nature : avec une campagne HC et une campagne EXC
 * pour la MÊME commission et année scolaire (le cas normal, voir le modèle "6 campagnes"),
 * `setCampagneId` de ce hook-là ne peut pas distinguer laquelle des deux on veut, puisque les deux
 * partagent la même commission — il retomberait toujours sur la première trouvée. Ce hook garde
 * donc son propre id local, comme HcExcCampagneCard (Import/Enseignants promouvables) et pour la
 * même raison — utilisé ici par les pages Adhérents éligibles et Mailing HC/EXC, qui n'ont pas
 * besoin de la création de campagne (propre à HcExcCampagneCard) mais ont le même besoin de
 * désambiguïser HC/EXC explicitement.
 */
export function useHcExcCampagneSelection(): {
  campagnes: Campagne[];
  campagneId: string | null;
  setCampagneId: (id: string) => void;
  selectedCampagne: Campagne | null;
} {
  const { campagnesAnneeSelectionnee } = useCampagneContext();
  const campagnes = campagnesAnneeSelectionnee.filter((c) => c.nature === "HC" || c.nature === "EXC");
  const [campagneId, setCampagneId] = useState<string | null>(null);

  useEffect(() => {
    if (campagnes.some((c) => c.id === campagneId)) return;
    setCampagneId(campagnes[0]?.id ?? null);
    // Gardé sur la liste jointe des id : `campagnes` est un nouveau tableau à chaque rendu (dérivé
    // du contexte) — ne doit se redéclencher que si l'ENSEMBLE des id change réellement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagnes.map((c) => c.id).join("|")]);

  const selectedCampagne = campagnes.find((c) => c.id === campagneId) ?? null;

  return { campagnes, campagneId, setCampagneId, selectedCampagne };
}
