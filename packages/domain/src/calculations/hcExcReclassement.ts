import { findEchelonRow, gainSalaireBrut, gainSalaireNet } from "./grille.js";
import { bankingDaysToYMD } from "./anciennete.js";
import { computeEchelonPromotion } from "./promotion.js";
import { reclassement, ancienneteReporteeReclassementHC } from "./hcExc.js";
import {
  RECLASSEMENT_PROFS_VERS_HORS_CLASSE,
  RECLASSEMENT_AGR_VERS_HORS_CLASSE,
  RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE,
  RECLASSEMENT_HC_AGR_VERS_CLASSE_EXCEPTIONNELLE,
} from "../data/refs.js";
import type { EchelonCode, EchelonRow, GrilleCode } from "../data/grilles.js";

export interface HcExcReclassementInput {
  processus: "HC" | "EXC";
  /** The grille the teacher is being promoted FROM: a classe-normale grille ("PROFS"/"AGR") for a
   * Hors Classe reclassement, or a Hors Classe grille ("HC_PROFS"/"HC_AGR") for a Classe
   * Exceptionnelle one. */
  grilleActuelle: GrilleCode;
  /** The échelon within `grilleActuelle` the teacher is being promoted FROM — numeric only for
   * now (see module doc comment for the known Agrégé lettered-échelon gap). */
  echelonActuel: number;
  /** The teacher's ancienneté in `echelonActuel`, in banking days, AS OF `dateReference` (not
   * necessarily as of whatever date it was last measured — project it forward first if needed). */
  ancienneteJoursAuReference: number;
  /** ISO date — the campagne's own reference date to project the post-reclassement promotion
   * from (the central spreadsheet's "premier jour de l'année scolaire", i.e. la rentrée). */
  dateReference: string;
  grilles?: Record<GrilleCode, EchelonRow[]>;
  valeurDuPoint?: number;
}

export interface HcExcReclassementResult {
  nouvelleGrille: GrilleCode;
  nouvelEchelon: EchelonCode;
  ancienIndice: number;
  nouvelIndice: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  /** The NEXT promotion after the one just landed on by this reclassement — null when the landed
   * échelon is already that grille's ceiling. */
  dateProchainePromotion: string | null;
  ancienneteReporteeJours: number;
}

/** Maps a grille moving into Hors Classe ("PROFS" -> "HC_PROFS") or from Hors Classe into Classe
 * Exceptionnelle ("HC_PROFS" -> "EXC_PROFS", "HC_AGR" -> "EXC_AGR") — matches the central
 * spreadsheet's own `Grade & " HC"` / `SUBSTITUTE(Grade,"HC","EXC")` formulas, expressed on grille
 * codes instead of grade labels (the two follow the exact same naming — see GRADE_MAPPINGS). */
function nouvelleGrilleApresReclassement(processus: "HC" | "EXC", grilleActuelle: GrilleCode): GrilleCode {
  return (processus === "HC" ? `HC_${grilleActuelle}` : grilleActuelle.replace("HC_", "EXC_")) as GrilleCode;
}

/**
 * Full Hors Classe / Classe Exceptionnelle reclassement pipeline: which échelon a teacher lands on
 * in the new grille, their new indice/salaire there, and their next promotion date after that —
 * ported from the central spreadsheet's own reclassement + `date_prochaine_promotion` VBA formula
 * (read directly from the workbook's macro source, not guessed): the new échelon's date is
 * projected forward from the campagne's own rentrée date, with the reclassement's carried-over
 * ancienneté (see `reclassement`/`ancienneteReporteeReclassementHC`) fed in exactly the same way
 * `computeEchelonPromotion` already accepts a reported ancienneté for the échelon-advancement path.
 *
 * ⚠️ Known gap: `echelonActuel` is numeric-only — an agrégé's lettered Hors Classe échelon (A1/A2/
 * A3) reclassing into Classe Exceptionnelle needs its own numeric encoding (per the spreadsheet's
 * own `conversion_numerique_echelon_HC_agrege` lookup) that isn't implemented here yet. Only call
 * this for a numeric échelon until that's added — an agrégé Classe Exceptionnelle reclassement is
 * not yet correctly handled.
 */
export function computeReclassementHcExc(input: HcExcReclassementInput): HcExcReclassementResult {
  const table =
    input.processus === "HC"
      ? input.grilleActuelle === "AGR"
        ? RECLASSEMENT_AGR_VERS_HORS_CLASSE
        : RECLASSEMENT_PROFS_VERS_HORS_CLASSE
      : input.grilleActuelle === "HC_AGR"
        ? RECLASSEMENT_HC_AGR_VERS_CLASSE_EXCEPTIONNELLE
        : RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE;

  const ancienneteAnnees = input.ancienneteJoursAuReference / 360;
  const cle = input.echelonActuel * 10 + ancienneteAnnees;
  const row = reclassement(table, cle);

  const ancienneteReporteeJours =
    input.processus === "HC"
      ? ancienneteReporteeReclassementHC(input.echelonActuel, input.ancienneteJoursAuReference, row.conservationAnciennete)
      : row.conservationAnciennete
        ? input.ancienneteJoursAuReference
        : 0;

  const nouvelleGrille = nouvelleGrilleApresReclassement(input.processus, input.grilleActuelle);
  const ancienIndice = findEchelonRow(input.grilleActuelle, input.echelonActuel, input.grilles).indice;

  const promo = computeEchelonPromotion({
    grille: nouvelleGrille,
    echelonDepart: row.echelonReclassement,
    dateDernierChangementEchelon: input.dateReference,
    ancienneteAReporter: bankingDaysToYMD(ancienneteReporteeJours),
    grilles: input.grilles,
    valeurDuPoint: input.valeurDuPoint,
  });

  return {
    nouvelleGrille,
    nouvelEchelon: row.echelonReclassement,
    ancienIndice,
    nouvelIndice: promo.indiceActuel,
    gainSalaireBrut: gainSalaireBrut(ancienIndice, promo.indiceActuel, input.valeurDuPoint),
    gainSalaireNet: gainSalaireNet(ancienIndice, promo.indiceActuel, input.valeurDuPoint),
    dateProchainePromotion: promo.dateProchainePromotion,
    ancienneteReporteeJours,
  };
}
