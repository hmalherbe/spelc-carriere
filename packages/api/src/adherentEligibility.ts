import { computeEchelonPromotion, GRADE_MAPPINGS, isEligibleCampagne, type GrilleCode } from "@spelc/domain";

// Maîtres délégués (1er et 2nd degré) : présents dans GRADE_MAPPINGS pour leur grille de
// rémunération (donc toujours affichés ailleurs dans l'appli), mais explicitement confirmés par le
// syndicat comme relevant d'une procédure d'avancement différente de la CCMA/CCMI — jamais
// éligibles à l'un ou l'autre, quelle que soit leur date de dernier changement d'échelon.
const GRADES_EXCLUS_CCMA_CCMI = new Set(["MD 1", "MD 2"]);

export interface AdherentEligibility {
  /** 2 = second degré (CCMA), 1 = premier degré (CCMI), null = grade inconnu (impossible à classer). */
  degre: 1 | 2 | null;
  dateProchainePromotion: string | null;
  eligible: boolean;
}

/**
 * Un adhérent est "éligible à la CCMA/CCMI" pour une campagne s'il est dû pour un changement
 * d'échelon pendant la période de cette campagne — calculé à partir de son grade (-> grille), son
 * échelon et sa date de dernier changement d'échelon ("Date_Effet" dans l'export ADEL), avec le
 * même moteur que pour les enseignants importés du rectorat (computeEchelonPromotion).
 *
 * Filtre aussi par commission quand celle de la campagne est connue (CCMA = second degré, CCMI =
 * premier degré) : un adhérent du premier degré n'est éligible que pour une campagne CCMI, jamais
 * CCMA, et réciproquement. Ce filtre n'a pu être activé qu'une fois la synchronisation ADEL
 * elle-même scindée par commission (le fichier récupéré suit celle de la campagne sélectionnée) —
 * avant ça, un même adhérent premier degré apparaissait comme "éligible" aussi bien côté CCMA que
 * CCMI, les deux campagnes d'une année scolaire partageant typiquement la même période. Reste
 * permissif (aucun filtre) quand la commission de la campagne n'est pas renseignée, pour ne pas
 * faire disparaître les données d'anciennes campagnes créées avant ce champ.
 *
 * Exclut aussi systématiquement les maîtres délégués (grades "MD 1"/"MD 2", voir
 * GRADES_EXCLUS_CCMA_CCMI) — pas un oubli de mapping, une exclusion métier délibérée.
 */
export function computeAdherentEligibility(
  adherent: { grade: string | null; ancienEchelon: string | null; dateEffet: Date | null },
  campagne: { periodeDebut: Date; periodeFin: Date; commission?: "CCMA" | "CCMI" | null },
): AdherentEligibility {
  if (!adherent.grade || !adherent.ancienEchelon || !adherent.dateEffet) {
    return { degre: null, dateProchainePromotion: null, eligible: false };
  }

  const mapping = GRADE_MAPPINGS.find((g) => g.grade.toUpperCase() === adherent.grade!.trim().toUpperCase());
  if (!mapping) {
    return { degre: null, dateProchainePromotion: null, eligible: false };
  }
  if (GRADES_EXCLUS_CCMA_CCMI.has(mapping.grade)) {
    return { degre: mapping.degre, dateProchainePromotion: null, eligible: false };
  }

  let dateProchainePromotion: string | null;
  try {
    dateProchainePromotion = computeEchelonPromotion({
      grille: mapping.grille as GrilleCode,
      echelonDepart: adherent.ancienEchelon,
      dateDernierChangementEchelon: adherent.dateEffet.toISOString().slice(0, 10),
    }).dateProchainePromotion;
  } catch {
    // Échelon introuvable dans la grille (donnée aberrante/mal saisie) — impossible à situer.
    dateProchainePromotion = null;
  }

  const periodeDebut = campagne.periodeDebut.toISOString().slice(0, 10);
  const periodeFin = campagne.periodeFin.toISOString().slice(0, 10);

  const degreCorrespondACommission =
    campagne.commission == null ||
    (campagne.commission === "CCMA" && mapping.degre === 2) ||
    (campagne.commission === "CCMI" && mapping.degre === 1);

  return {
    degre: mapping.degre,
    dateProchainePromotion,
    eligible: degreCorrespondACommission && isEligibleCampagne(dateProchainePromotion, periodeDebut, periodeFin),
  };
}
