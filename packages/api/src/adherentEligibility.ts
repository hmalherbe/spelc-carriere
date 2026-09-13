import { computeEchelonPromotion, GRADE_MAPPINGS, isEligibleCampagne, type GrilleCode } from "@spelc/domain";

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
 * Ne préjuge pas de la commission réellement compétente au-delà du simple degré (CCMA = second
 * degré, CCMI = premier degré) — c'est une étiquette informative, pas un filtre : un adhérent du
 * premier degré éligible reste éligible même si l'app ne suit pour l'instant aucune donnée
 * rectorat CCMI (voir `nonPresentDansRectorat` côté appelant, plutôt qu'une exclusion silencieuse).
 */
export function computeAdherentEligibility(
  adherent: { grade: string | null; ancienEchelon: string | null; dateEffet: Date | null },
  campagne: { periodeDebut: Date; periodeFin: Date },
): AdherentEligibility {
  if (!adherent.grade || !adherent.ancienEchelon || !adherent.dateEffet) {
    return { degre: null, dateProchainePromotion: null, eligible: false };
  }

  const mapping = GRADE_MAPPINGS.find((g) => g.grade.toUpperCase() === adherent.grade!.trim().toUpperCase());
  if (!mapping) {
    return { degre: null, dateProchainePromotion: null, eligible: false };
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

  return {
    degre: mapping.degre,
    dateProchainePromotion,
    eligible: isEligibleCampagne(dateProchainePromotion, periodeDebut, periodeFin),
  };
}
