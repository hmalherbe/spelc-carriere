import { findEchelonRow, gainSalaireBrut, gainSalaireNet, traitementBrutMensuel } from "./grille.js";
import { ancienneteToBankingDays, addCalendarYMD, bankingDaysToYMD } from "./anciennete.js";
import type { AncienneteYMD, PromotionResult } from "../types.js";
import type { EchelonCode, GrilleCode } from "../data/grilles.js";

export interface ComputeEchelonPromotionInput {
  grille: GrilleCode;
  echelonDepart: EchelonCode;
  dateDernierChangementEchelon: string; // ISO date
  ancienneteADeduire?: AncienneteYMD | null;
  ancienneteAReporter?: AncienneteYMD | null;
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
  const { grille, echelonDepart, dateDernierChangementEchelon, ancienneteADeduire, ancienneteAReporter } = input;

  const currentRow = findEchelonRow(grille, echelonDepart);
  const indiceActuel = currentRow.indice;

  if (currentRow.duree === "MAX") {
    return {
      grille,
      echelonDepart,
      echelonSuivant: currentRow.echelonSuivant,
      indiceActuel,
      futurIndice: indiceActuel,
      ancienTraitementBrutMensuel: traitementBrutMensuel(indiceActuel),
      futurTraitementBrutMensuel: traitementBrutMensuel(indiceActuel),
      gainSalaireBrut: 0,
      gainSalaireNet: 0,
      dateProchainePromotion: null,
    };
  }

  const nextRow = findEchelonRow(grille, currentRow.echelonSuivant);
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
    ancienTraitementBrutMensuel: traitementBrutMensuel(indiceActuel),
    futurTraitementBrutMensuel: traitementBrutMensuel(futurIndice),
    gainSalaireBrut: gainSalaireBrut(indiceActuel, futurIndice),
    gainSalaireNet: gainSalaireNet(indiceActuel, futurIndice),
    dateProchainePromotion,
  };
}
