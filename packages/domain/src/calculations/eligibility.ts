import type { EchelonCode } from "../data/grilles.js";
import type { EchelonBA } from "./baThreshold.js";

/**
 * Eligibility gates for the three PPCR career-advancement mechanisms, as confirmed against the
 * grille indiciaire durées (échelon 6/8 durées of 3/3.5 years match the "2 ans/2,5 ans avec BA"
 * figures exactly) and the union's own description of the current rules. These are deliberately
 * separate from `computeEchelonPromotion` (which always projects the non-accelerated timeline) and
 * from `baThreshold.ts` (which decides who, among the eligible pool, actually clears the
 * competitive selection bar) — this module only answers "is this teacher even in the running".
 */

/**
 * BA (bonification d'ancienneté) eligibility window — being in this window doesn't guarantee the
 * accelerated promotion (only ~30% of the eligible pool gets it, decided by the competitive
 * threshold in baThreshold.ts), but being OUTSIDE it means "not even a candidate this campaign".
 *   - échelon 6 -> 7 : "être dans la 2e année de cet échelon" -> ancienneté in [1, 2) years.
 *   - échelon 8 -> 9 : "entre 18 et 30 mois" -> ancienneté in [1.5, 2.5] years.
 */
export function isEligibleBonificationAnciennete(echelonDepart: EchelonBA, ancienneteEchelonAnnees: number): boolean {
  if (echelonDepart === 6) {
    return ancienneteEchelonAnnees >= 1 && ancienneteEchelonAnnees < 2;
  }
  return ancienneteEchelonAnnees >= 1.5 && ancienneteEchelonAnnees <= 2.5;
}

/**
 * Accès à la hors-classe : échelon 9 de la classe normale avec au moins 2 ans d'ancienneté dans
 * cet échelon (arrêtée au 31 août de l'année d'établissement du tableau d'avancement), OU
 * directement éligible pour quiconque a déjà atteint l'échelon 10 ou 11.
 */
export function isEligibleHorsClasse(echelonClasseNormale: EchelonCode, ancienneteEchelonAnnees: number): boolean {
  const echelon = Number(echelonClasseNormale);
  if (!Number.isFinite(echelon)) return false;
  if (echelon === 9) return ancienneteEchelonAnnees >= 2;
  return echelon === 10 || echelon === 11;
}

/**
 * Accès à la classe exceptionnelle (réforme 2024) : purement statutaire, aucune ancienneté
 * supplémentaire requise — il suffit d'avoir atteint l'échelon de départ requis au 31 août de
 * l'année de promotion.
 *   - Échelon 5 de la hors-classe pour la plupart des corps.
 *   - Échelon 4 de la hors-classe pour les agrégés — dans la grille agrégés, les échelons 4 à 6
 *     de la hors-classe sont numérotés "A1"/"A2"/"A3" plutôt que 4/5/6, donc "échelon 4" = "A1".
 *
 * Remplace le système à points (bonification avis + points d'ancienneté, voir les tables
 * POINTS_ANCIENNETE_EXC_* / POINTS_BONIFICATION_EXC_AVIS_RECTEUR dans refs.ts) qui s'appliquait
 * avant la réforme 2024 — ces tables restent dans le code à titre historique mais ne doivent plus
 * servir à déterminer l'éligibilité.
 */
export function isEligibleClasseExceptionnelle(echelonHorsClasse: EchelonCode, corps: "agrege" | "autre"): boolean {
  if (corps === "agrege") {
    return echelonHorsClasse === "A1" || echelonHorsClasse === "A2" || echelonHorsClasse === "A3";
  }
  const echelon = Number(echelonHorsClasse);
  return Number.isFinite(echelon) && echelon >= 5;
}
