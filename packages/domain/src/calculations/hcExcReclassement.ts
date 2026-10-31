import { findEchelonRow, gainSalaireBrut, gainSalaireNet } from "./grille.js";
import { bankingDaysToYMD } from "./anciennete.js";
import { computeEchelonPromotion } from "./promotion.js";
import { reclassement, ancienneteReporteeReclassementHC } from "./hcExc.js";
import {
  RECLASSEMENT_PROFS_VERS_HORS_CLASSE,
  RECLASSEMENT_AGR_VERS_HORS_CLASSE,
  RECLASSEMENT_BI_ADMISSIBLE_PROFS_VERS_HORS_CLASSE,
  RECLASSEMENT_PEGC_VERS_HORS_CLASSE,
  RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE,
  RECLASSEMENT_HC_AGR_VERS_CLASSE_EXCEPTIONNELLE,
  RECLASSEMENT_HC_PEGC_VERS_CLASSE_EXCEPTIONNELLE,
  type ReclassementRow,
} from "../data/refs.js";
import type { EchelonCode, EchelonRow, GrilleCode } from "../data/grilles.js";

/** Quelle table de correspondance utiliser pour chaque grille d'origine — reproduit le choix
 * générique du classeur (`INDIRECT("reclassement_"&VLOOKUP(grade,Grades_echelles,6,FALSE))`),
 * plutôt que l'ancien branchement binaire "AGR ou pas" qui retombait, à tort, sur la table PROFS
 * pour toute autre grille (BI_ADM, PEGC...). */
const TABLES_RECLASSEMENT: Partial<Record<GrilleCode, ReclassementRow[]>> = {
  PROFS: RECLASSEMENT_PROFS_VERS_HORS_CLASSE,
  AGR: RECLASSEMENT_AGR_VERS_HORS_CLASSE,
  BI_ADM: RECLASSEMENT_BI_ADMISSIBLE_PROFS_VERS_HORS_CLASSE,
  PEGC: RECLASSEMENT_PEGC_VERS_HORS_CLASSE,
  HC_PROFS: RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE,
  HC_AGR: RECLASSEMENT_HC_AGR_VERS_CLASSE_EXCEPTIONNELLE,
  HC_PEGC: RECLASSEMENT_HC_PEGC_VERS_CLASSE_EXCEPTIONNELLE,
};

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
 * codes instead of grade labels (the two follow the exact same naming — see GRADE_MAPPINGS).
 *
 * Exception : "BI_ADM" (Certifié/PLP/PEPS bi-admissible) atterrit dans "HC_PROFS" ordinaire, pas
 * dans une "HC_BI_ADM" qui n'existe pas (ni dans GRILLES ni comme table de correspondance dans le
 * classeur) — la bi-admissibilité ne distingue que la classe normale. */
function nouvelleGrilleApresReclassement(processus: "HC" | "EXC", grilleActuelle: GrilleCode): GrilleCode {
  if (processus === "HC") return grilleActuelle === "BI_ADM" ? "HC_PROFS" : ((`HC_${grilleActuelle}`) as GrilleCode);
  return grilleActuelle.replace("HC_", "EXC_") as GrilleCode;
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
  const table = TABLES_RECLASSEMENT[input.grilleActuelle];
  if (!table) {
    throw new Error(`Aucune table de reclassement connue pour la grille ${input.grilleActuelle}`);
  }

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
