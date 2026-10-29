import { classerParAncienneteJours, findEchelonRow, gainSalaireBrut, gainSalaireNet, seuilEntreeEchelon } from "./grille.js";
import { joursComptablesEntre } from "./anciennete.js";
import { simplifierFraction } from "./fraction.js";
import { COEFFICIENT_CARACTERISTIQUE, SITUATIONS_AVANT_RECLASSEMENT } from "../data/refs.js";
import { GRILLES, type EchelonRow, type GrilleCode } from "../data/grilles.js";

/**
 * Reclassement après concours (Reclt concours & reprise d'ancienneté) and reclassement après
 * concours depuis la hors-classe/classe exceptionnelle (reconstitution virtuelle) — ported from the
 * union's "260824_Reclassements.xls" (VBA/formula decompilation of its "Reclt concours & Reprise
 * anc." and "Reclt concours HC et EXC" sheets, via oletools + a patched xlrd formula decompiler,
 * same method already used for computeReclassementHcExc). Distinct from that function: this module
 * covers a teacher being newly admitted to a corps by concours, not an existing hors-classe/classe-
 * exceptionnelle grade change.
 */

/**
 * One prior-service period already resolved to a day count — the 3 ways the union's own tool lets
 * someone enter a period (échelon+reliquat, start/end dates, or a raw day count) are a UI-input
 * concern, not a domain one: whichever was used, the caller passes the resulting day count here,
 * reliquat (situation 1) already folded in — it's weighted by quotité/coefficient exactly like the
 * rest of `joursBruts`, confirmed against the union's own real-world use of the tool (a separate
 * unweighted "reliquat" treatment was tried first and found wrong).
 */
export interface ServiceAnterieur {
  /** Must match a `nature` in SITUATIONS_AVANT_RECLASSEMENT (refs.ts) — thrown if not. */
  nature: string;
  joursBruts: number;
  /**
   * Quotité de travail (0 < quotité <= 1) during this service — a part-time service at or above
   * mi-temps (>= 0.5) counts as full-time for ancienneté purposes (a real, easily-missed rule: the
   * spreadsheet's own `IF(quotite>=0.5,1,quotite)` clamp), a service below mi-temps counts pro rata.
   * Defaults to 1 (temps complet).
   */
  quotite?: number;
}

export interface ReclassementConcoursInput {
  /** Only the two grilles the union's own tool exposes as a reclassement target. */
  grilleCible: "AGR" | "PROFS";
  services: ServiceAnterieur[];
}

export interface ReclassementConcoursResult {
  totalJoursRetenus: number;
  echelon: number;
  ancienneteReporteeJours: number;
}

/** Recherche la situation d'une nature de service dans SITUATIONS_AVANT_RECLASSEMENT (refs.ts) —
 * lève si inconnue, mêmes conditions que computeReclassementConcours ci-dessous. */
function trouverSituation(nature: string) {
  const situation = SITUATIONS_AVANT_RECLASSEMENT.find((s) => s.nature === nature);
  if (!situation) {
    throw new Error(`Nature de service inconnue: ${JSON.stringify(nature)}`);
  }
  return situation;
}

/** Le "coefficient de reclassement" réellement appliqué à une nature de service pour un corps
 * cible donné, sous forme de fraction irréductible — soit directement la pondération de la
 * situation (ex. 2/3), soit coefficientOrigine/coefficientCible réduit (ex. 115/175 -> 23/35).
 * Même source que le ratio utilisé par computeReclassementConcours, pour qu'affichage et calcul ne
 * puissent jamais diverger. */
export function coefficientAppliqueFraction(nature: string, grilleCible: "AGR" | "PROFS"): { numerateur: number; denominateur: number } {
  const situation = trouverSituation(nature);
  const coefficientCible = COEFFICIENT_CARACTERISTIQUE[grilleCible];
  if (coefficientCible == null) {
    throw new Error(`Pas de coefficient caractéristique connu pour la grille ${grilleCible}`);
  }
  return situation.ponderation.mode === "ponderation"
    ? simplifierFraction(situation.ponderation.numerateur, situation.ponderation.denominateur)
    : simplifierFraction(situation.ponderation.coefficient, coefficientCible);
}

/** Jours réellement retenus pour UN service (après clamp de quotité, coefficient/pondération et
 * bonus "Contractuel alternant") — exporté pour que l'interface puisse afficher la contribution
 * exacte de chaque ligne au total, pas seulement ses jours bruts avant pondération. Seule source
 * pour ce calcul : computeReclassementConcours ci-dessous additionne exactement cette valeur,
 * jamais une réimplémentation séparée. */
export function joursRetenusPourService(service: ServiceAnterieur, grilleCible: "AGR" | "PROFS"): number {
  trouverSituation(service.nature); // valide la nature avant de calculer quoi que ce soit
  const { numerateur, denominateur } = coefficientAppliqueFraction(service.nature, grilleCible);
  const ratio = numerateur / denominateur;
  const quotite = service.quotite ?? 1;
  // The spreadsheet's own clamp: temps partiel >= mi-temps compte comme temps complet.
  const multiplicateurQuotite = quotite >= 0.5 ? 1 : quotite;
  // "Contractuel alternant" gets a flat 2-month (60 banking-day) bonus — read directly from the
  // spreadsheet's own S column formula, not documented anywhere else we could find.
  const bonusAlternant = service.nature === "Contractuel alternant" ? 60 : 0;
  return Math.round(Math.round(service.joursBruts * multiplicateurQuotite) * ratio) + bonusAlternant;
}

/** Reclt concours & reprise d'ancienneté — classes a set of prior-service periods, weighted and
 * converted to the target grille's own coefficient caractéristique, into a landing échelon + report
 * d'ancienneté in `grilleCible`. */
export function computeReclassementConcours(input: ReclassementConcoursInput): ReclassementConcoursResult {
  if (COEFFICIENT_CARACTERISTIQUE[input.grilleCible] == null) {
    throw new Error(`Pas de coefficient caractéristique connu pour la grille ${input.grilleCible}`);
  }

  let total = 0;
  for (const service of input.services) {
    total += joursRetenusPourService(service, input.grilleCible);
  }

  const totalJoursRetenus = Math.floor(total);
  const { echelon, reportJours } = classerParAncienneteJours(input.grilleCible, totalJoursRetenus);
  return { totalJoursRetenus, echelon, ancienneteReporteeJours: reportJours };
}

export interface ReclassementConcoursDepuisHcExcInput {
  /** The hors-classe/classe-exceptionnelle grille the teacher is reclassing FROM. */
  grilleOrigine: GrilleCode;
  echelonActuel: number;
  /** ISO — date d'effet de `echelonActuel`. */
  dateEchelon: string;
  /** ISO — date du reclassement (jour de la nomination issue du concours). */
  dateReclassement: string;
  /** Majorations d'ancienneté (décret 2022-708), in banking days — only the ones applicable to
   * `grilleOrigine`/`echelonActuel` are added; see the spreadsheet's own conditional display for
   * which combination needs which. Passing an inapplicable one is harmless (it's simply not added
   * — see the loop below). */
  majorations?: { cn11Jours?: number; hc6Jours?: number; exc4Jours?: number };
  /** Defaults to "AGR" — the only target the union's own tool currently reclasses into from HC/EXC via concours. */
  grilleCible?: "AGR" | "PROFS";
  grilles?: Record<GrilleCode, EchelonRow[]>;
  valeurDuPoint?: number;
}

export interface ReclassementConcoursDepuisHcExcResult {
  baseTheoriqueJours: number;
  joursAcquisDansEchelon: number;
  totalReconstitueJours: number;
  nouvelleGrille: "AGR" | "PROFS";
  nouvelEchelon: number;
  ancienneteReporteeJours: number;
  ancienIndice: number;
  nouvelIndice: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  /** coefficientOrigine/coefficientCible réduit à sa forme irréductible (ex. 135/175 -> 27/35) —
   * le "coefficient de reclassement" appliqué pour convertir `totalVirtuelCN` en `totalReconstitueJours`. */
  coefficientFraction: { numerateur: number; denominateur: number };
}

/**
 * "Base théorique d'équivalence" in the target classe-normale grille for a given hors-classe/
 * classe-exceptionnelle (processus, échelon) pair — ported as-is from the spreadsheet's own
 * cumulative-threshold constants (expressed here against `grilleCible`'s own `duree` data instead
 * of a hand-maintained table, via `seuilEntreeEchelon`). Throws for an échelon outside the known
 * mapping (1-7 for HC, 1-5 for EXC) — matches the union's own tool, which doesn't support others.
 */
function baseTheoriqueJours(
  processus: "HC" | "EXC",
  echelonActuel: number,
  grilleCible: "AGR" | "PROFS",
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): number {
  const seuil = (echelon: number) => seuilEntreeEchelon(grilleCible, echelon, grilles);
  if (processus === "HC") {
    switch (echelonActuel) {
      case 1:
        return seuil(8);
      case 2:
        return seuil(9) + 720;
      case 3:
        return seuil(10);
      case 4:
        return seuil(11);
      case 5:
        return seuil(11) + 900;
      case 6:
        return seuil(11) + 1980;
      case 7:
        return seuil(11) + 3060;
    }
  } else {
    switch (echelonActuel) {
      case 1:
        return seuil(10);
      case 2:
        return seuil(11);
      case 3:
        return seuil(11) + 900;
      case 4:
        return seuil(11) + 1980;
      case 5:
        return seuil(11) + 3060;
    }
  }
  throw new Error(`Échelon ${processus} ${echelonActuel} non pris en charge par le reclassement concours HC/EXC`);
}

/** Reclt concours HC et EXC — reconstitution virtuelle dans la classe normale, pour un agent
 * hors-classe/classe-exceptionnelle reçu à un concours d'un corps supérieur. */
export function computeReclassementConcoursDepuisHcExc(input: ReclassementConcoursDepuisHcExcInput): ReclassementConcoursDepuisHcExcResult {
  const processus: "HC" | "EXC" = input.grilleOrigine.startsWith("HC_") ? "HC" : "EXC";
  const grilleCible = input.grilleCible ?? "AGR";
  const coefficientOrigine = COEFFICIENT_CARACTERISTIQUE[input.grilleOrigine];
  const coefficientCible = COEFFICIENT_CARACTERISTIQUE[grilleCible];
  if (coefficientOrigine == null || coefficientCible == null) {
    throw new Error(`Coefficient caractéristique inconnu pour ${input.grilleOrigine} ou ${grilleCible}`);
  }

  const base = baseTheoriqueJours(processus, input.echelonActuel, grilleCible, input.grilles);
  const joursAcquisDansEchelon = joursComptablesEntre(input.dateEchelon, input.dateReclassement);

  const majCN11 = (processus === "HC" && input.echelonActuel >= 5) || (processus === "EXC" && input.echelonActuel >= 3) ? input.majorations?.cn11Jours ?? 0 : 0;
  const majHC6 = (processus === "HC" && input.echelonActuel >= 7) || (processus === "EXC" && input.echelonActuel >= 4) ? input.majorations?.hc6Jours ?? 0 : 0;
  const majEXC4 = processus === "EXC" && input.echelonActuel >= 5 ? input.majorations?.exc4Jours ?? 0 : 0;

  const totalVirtuelCN = base + joursAcquisDansEchelon + majCN11 + majHC6 + majEXC4;
  const totalReconstitueJours = Math.floor(totalVirtuelCN * (coefficientOrigine / coefficientCible));

  const { echelon: nouvelEchelon, reportJours } = classerParAncienneteJours(grilleCible, totalReconstitueJours, input.grilles);

  const ancienIndice = findEchelonRow(input.grilleOrigine, input.echelonActuel, input.grilles).indice;
  const indiceTheorique = findEchelonRow(grilleCible, nouvelEchelon, input.grilles).indice;
  // "Conservation de l'indice avant reclassement" — a concours reclassement can never land on a
  // lower indice than the one already held (a real rule, missing from the previous standalone
  // simulator — see the spreadsheet's own G26/G29 formulas).
  const nouvelIndice = Math.max(indiceTheorique, ancienIndice);

  return {
    baseTheoriqueJours: base,
    joursAcquisDansEchelon,
    totalReconstitueJours,
    nouvelleGrille: grilleCible,
    nouvelEchelon,
    ancienneteReporteeJours: reportJours,
    ancienIndice,
    nouvelIndice,
    gainSalaireBrut: gainSalaireBrut(ancienIndice, nouvelIndice, input.valeurDuPoint),
    gainSalaireNet: gainSalaireNet(ancienIndice, nouvelIndice, input.valeurDuPoint),
    coefficientFraction: simplifierFraction(coefficientOrigine, coefficientCible),
  };
}
