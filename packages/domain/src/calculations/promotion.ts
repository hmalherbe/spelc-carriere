import { findEchelonRow, gainSalaireBrut, gainSalaireNet, traitementBrutMensuel } from "./grille.js";
import { ancienneteToBankingDays, addCalendarYMD, bankingDaysToYMD } from "./anciennete.js";
import type { AncienneteYMD, PromotionResult } from "../types.js";
import { GRILLES, type EchelonCode, type EchelonRow, type GrilleCode } from "../data/grilles.js";
import { VALEUR_DU_POINT } from "../data/refs.js";

export interface ComputeEchelonPromotionInput {
  grille: GrilleCode;
  echelonDepart: EchelonCode;
  dateDernierChangementEchelon: string; // ISO date
  ancienneteADeduire?: AncienneteYMD | null;
  ancienneteAReporter?: AncienneteYMD | null;
  /** Overrides the built-in grille tables — pass the current values from the database when an
   * admin may have edited the indices (see packages/api/src/liveGrilles.ts). */
  grilles?: Record<GrilleCode, EchelonRow[]>;
  /** Overrides the built-in "valeur du point d'indice" — pass the current value from the database. */
  valeurDuPoint?: number;
}

/**
 * Ports the central spreadsheet's échelon-change engine:
 *   1. look up (échelon suivant, durée, indice actuel, futur indice) in the grade's grille
 *   2. convert the "durée" (in years) to banking-calendar days, adjusted by any ancienneté
 *      déduite/reportée carried over from a prior grade or contract
 *   3. project that many days forward from the date of the last échelon change, using REAL
 *      calendar arithmetic, to get the next promotion date
 *   4. compute the salary gain (brut and net) of that promotion
 *
 * Returns null-ish `dateProchainePromotion` when the current échelon is already the grille's
 * ceiling ("MAX" durée) — there is no next promotion to compute.
 */
export function computeEchelonPromotion(input: ComputeEchelonPromotionInput): PromotionResult {
  const {
    grille,
    echelonDepart,
    dateDernierChangementEchelon,
    ancienneteADeduire,
    ancienneteAReporter,
    grilles = GRILLES,
    valeurDuPoint = VALEUR_DU_POINT,
  } = input;

  const currentRow = findEchelonRow(grille, echelonDepart, grilles);
  const indiceActuel = currentRow.indice;

  if (currentRow.duree === "MAX") {
    return {
      grille,
      echelonDepart,
      echelonSuivant: currentRow.echelonSuivant,
      indiceActuel,
      futurIndice: indiceActuel,
      ancienTraitementBrutMensuel: traitementBrutMensuel(indiceActuel, valeurDuPoint),
      futurTraitementBrutMensuel: traitementBrutMensuel(indiceActuel, valeurDuPoint),
      gainSalaireBrut: 0,
      gainSalaireNet: 0,
      dateProchainePromotion: null,
    };
  }

  const nextRow = findEchelonRow(grille, currentRow.echelonSuivant, grilles);
  const futurIndice = nextRow.indice;

  const joursADeduire = ancienneteToBankingDays(ancienneteADeduire);
  const joursAReporter = ancienneteToBankingDays(ancienneteAReporter);
  const dureeEnJours = currentRow.duree * 360;
  const nbJoursChangementEchelon = dureeEnJours + joursADeduire - joursAReporter;

  const offset = bankingDaysToYMD(nbJoursChangementEchelon);
  const dateProchainePromotion = addCalendarYMD(dateDernierChangementEchelon, offset);

  return {
    grille,
    echelonDepart,
    echelonSuivant: currentRow.echelonSuivant,
    indiceActuel,
    futurIndice,
    ancienTraitementBrutMensuel: traitementBrutMensuel(indiceActuel, valeurDuPoint),
    futurTraitementBrutMensuel: traitementBrutMensuel(futurIndice, valeurDuPoint),
    gainSalaireBrut: gainSalaireBrut(indiceActuel, futurIndice, valeurDuPoint),
    gainSalaireNet: gainSalaireNet(indiceActuel, futurIndice, valeurDuPoint),
    dateProchainePromotion,
  };
}
