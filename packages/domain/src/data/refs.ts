// AUTO-EXTRACTED from the Spelc central .xlsm (sheet "Données") — DO NOT hand-edit.
import type { GrilleCode } from "./grilles.js";

/** Annual value (in €) of one "point d'indice" — used to convert an indice into a gross monthly salary. */
export const VALEUR_DU_POINT = 59.07336;

/**
 * Maps a rectorat "Grade" label (as it appears in the rectorat export / ADEL) to:
 * - the salary grille to use (GrilleCode)
 * - the "degré" (1 = premier degré / professeur des écoles, 2 = second degré)
 * - whether this grade is eligible for "accès à la hors classe" and/or "accès à la classe exceptionnelle"
 */
export interface GradeMapping {
  grade: string;
  grille: GrilleCode;
  degre: 1 | 2;
  accesHorsClasse: boolean;
  accesClasseExceptionnelle: boolean;
}

export const GRADE_MAPPINGS: GradeMapping[] = [
  { grade: "AGREGE", grille: "AGR", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "AECE", grille: "AECE", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "CERTIFIE", grille: "PROFS", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "PEPS", grille: "PROFS", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "PLP", grille: "PROFS", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "Prof. Ecoles", grille: "PROFS", degre: 1, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "CERTIFIE HC", grille: "HC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: true },
  { grade: "PEPS HC", grille: "HC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: true },
  { grade: "PLP HC", grille: "HC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: true },
  { grade: "Prof. Ecoles HC", grille: "HC_PROFS", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: true },
  { grade: "AGREGE HC", grille: "HC_AGR", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: true },
  { grade: "CERTIFIE BI-ADMISSIBLE", grille: "BI_ADM", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "PEPS BI-ADMISSIBLE", grille: "BI_ADM", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "PLP BI-ADMISSIBLE", grille: "BI_ADM", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "PEGC-CE d'EPS", grille: "PEGC", degre: 2, accesHorsClasse: true, accesClasseExceptionnelle: false },
  { grade: "Instituteur", grille: "INSTIT", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "PEGC-CE d'EPS HC", grille: "HC_PEGC", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: true },
  // "MA 1"/"MA 2" (the source spreadsheet's original label, matching the GrilleCode keys below)
  // was the premier-degré maître auxiliaire grade's name at the time the sheet was extracted — the
  // union itself confirmed it's since been renamed "MD 1"/"MD 2" (ADEL now exports adherents under
  // that label), so the label here follows suit. Left the internal `grille` code ("MA_1"/"MA_2",
  // and the matching GRILLES table key in grilles.ts) unchanged: it's never shown to a user, only
  // this "grade" text is — and it's what ADEL/rectorat grade strings get compared against for
  // adhérent<->enseignant matching (see @spelc/import's matchAdherents).
  { grade: "MD 1", grille: "MA_1", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "MD 2", grille: "MA_2", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "CERTIFIE EXC", grille: "EXC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "PEPS EXC", grille: "EXC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "PLP EXC", grille: "EXC_PROFS", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "Prof. Ecoles EXC", grille: "EXC_PROFS", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "AGREGE EXC", grille: "EXC_AGR", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "PEGC-CE d'EPS EXC", grille: "EXC_PEGC", degre: 2, accesHorsClasse: false, accesClasseExceptionnelle: false },
];

/** The 0-4 numeric "avis d'évaluation" (EVAECH in the rectorat exports) mapped to its text label. */
export const AVIS_LABELS: Record<number, string> = {
  0: "Non renseigné",
  1: "A consolider",
  2: "Satisfaisant",
  3: "Très satisfaisant",
  4: "Excellent",
};

/**
 * Points de bonification "avis du recteur" pour l'accès à la hors classe.
 * [avis, points 1er degré (Prof. Ecoles), points 2nd degré]
 */
export const POINTS_BONIFICATION_HC_AVIS_RECTEUR: { avis: string; points1erDegre: number; points2ndDegre: number }[] = [
  { avis: "Excellent", points1erDegre: 120, points2ndDegre: 145 },
  { avis: "Très satisfaisant", points1erDegre: 100, points2ndDegre: 125 },
  { avis: "Satisfaisant", points1erDegre: 80, points2ndDegre: 105 },
  { avis: "A consolider", points1erDegre: 60, points2ndDegre: 95 },
];

/** Points de bonification "avis du recteur" pour l'accès à la classe exceptionnelle (tous corps). */
export const POINTS_BONIFICATION_EXC_AVIS_RECTEUR: { avis: string; points: number }[] = [
  { avis: "Excellent", points: 140 },
  { avis: "Très satisfaisant", points: 90 },
  { avis: "Satisfaisant", points: 40 },
  { avis: "A consolider", points: 0 },
];

/**
 * Points d'ancienneté pour l'accès à la hors classe — deux barèmes distincts (1er degré / 2nd
 * degré), comme pour POINTS_BONIFICATION_HC_AVIS_RECTEUR ; ils coïncident jusqu'à clé 103 puis
 * divergent à partir de clé 110 (échelon 11).
 * key = échelon*10 + ancienneté dans l'échelon (ex: échelon 9, 2 ans d'ancienneté -> clé 92)
 */
export const POINTS_ANCIENNETE_HC: { cle: number; points1erDegre: number; points2ndDegre: number }[] = [
  { cle: 92, points1erDegre: 0, points2ndDegre: 0 },
  { cle: 93, points1erDegre: 10, points2ndDegre: 10 },
  { cle: 100, points1erDegre: 20, points2ndDegre: 20 },
  { cle: 101, points1erDegre: 30, points2ndDegre: 30 },
  { cle: 102, points1erDegre: 40, points2ndDegre: 40 },
  { cle: 103, points1erDegre: 50, points2ndDegre: 50 },
  { cle: 110, points1erDegre: 70, points2ndDegre: 60 },
  { cle: 111, points1erDegre: 80, points2ndDegre: 70 },
  { cle: 112, points1erDegre: 90, points2ndDegre: 80 },
  { cle: 113, points1erDegre: 100, points2ndDegre: 100 },
  { cle: 114, points1erDegre: 110, points2ndDegre: 110 },
  { cle: 115, points1erDegre: 120, points2ndDegre: 120 },
  { cle: 116, points1erDegre: 120, points2ndDegre: 130 },
  { cle: 117, points1erDegre: 120, points2ndDegre: 140 },
  { cle: 118, points1erDegre: 120, points2ndDegre: 150 },
  { cle: 119, points1erDegre: 120, points2ndDegre: 160 },
];

/** Points d'ancienneté pour l'accès à la classe exceptionnelle — certifiés/PLP/PEPS/Prof. Ecoles HC. */
export const POINTS_ANCIENNETE_EXC_CERTIFIES: { cle: number; points: number }[] = [
  { cle: 30, points: 3 }, { cle: 31, points: 6 }, { cle: 32, points: 9 }, { cle: 40, points: 12 },
  { cle: 41, points: 15 }, { cle: 42, points: 18 }, { cle: 42.5, points: 21 }, { cle: 50, points: 24 },
  { cle: 51, points: 27 }, { cle: 52, points: 30 }, { cle: 53, points: 33 }, { cle: 60, points: 36 },
  { cle: 61, points: 39 }, { cle: 62, points: 42 }, { cle: 63, points: 45 }, { cle: 64, points: 48 },
];

/** Points d'ancienneté pour l'accès à la classe exceptionnelle — agrégés HC. */
export const POINTS_ANCIENNETE_EXC_AGREGES: { cle: number; points: number }[] = [
  { cle: 20, points: 3 }, { cle: 21, points: 6 }, { cle: 22, points: 9 }, { cle: 30, points: 12 },
  { cle: 31, points: 15 }, { cle: 32, points: 18 }, { cle: 33, points: 21 }, { cle: 40, points: 24 },
  { cle: 41, points: 27 }, { cle: 42, points: 30 }, { cle: 43, points: 33 }, { cle: 44, points: 36 },
  { cle: 45, points: 39 }, { cle: 46, points: 42 }, { cle: 47, points: 45 }, { cle: 48, points: 48 },
];

/** One row of a "reclassement" table: given echelon*10+ancienneté in the old grille, what echelon do you land on in the new grille, and is the ancienneté within that echelon kept ("conservation ancienneté")? */
export interface ReclassementRow {
  cle: number;
  echelonReclassement: string | number;
  conservationAnciennete: boolean;
}

// Les 7 tables ci-dessous sont lues directement de Données!D134:F204 du classeur source (chacune
// sous son propre nom "reclassement_<suffixe>", choisi par une formule générique
// INDIRECT("reclassement_"&VLOOKUP(grade,Grades_echelles,6,FALSE)) côté classeur — voir
// computeReclassementHcExc, calculations/hcExcReclassement.ts, qui reproduit ce choix de table par
// grille plutôt que l'ancien branchement "AGR ou pas"). Relu intégralement le 2026-11-01 : PROFS et
// AGR avaient chacune une ligne manquante (cle 94, Non) et HC_PROFS en avait deux (cle 70 et 73) en
// plus d'un drapeau conservationAnciennete inversé pour sa ligne cle=60 (Non, pas Oui) — corrigés ;
// une clé manquante fausse le résultat de vlookupApprox pour toute ancienneté tombant dans l'écart
// laissé vacant, pas seulement sur la clé exacte absente. HC_AGR, seule à l'origine complète,
// confirmée inchangée. Les codes d'échelon lettrés du classeur ("2-HEA1"/"3-HEB2"...) sont traduits
// ici en les codes qu'utilise réellement GRILLES.HC_AGR/EXC_AGR ("A1"/"B2"...).
export const RECLASSEMENT_PROFS_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 94, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 100, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 102.5, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 112.5, echelonReclassement: 5, conservationAnciennete: false },
];

export const RECLASSEMENT_AGR_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 94, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 100, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 102, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 113, echelonReclassement: "A1", conservationAnciennete: false },
];

/** Certifié/PLP/PEPS/Prof. Ecoles classe exceptionnelle, échelon 4 (son seul échelon de départ
 * pertinent ici — un seul échelon possible, pas de palier ancienneté-dépendant, donc une seule
 * ligne) → "chevron HEA1" dans le classeur, confirmé par l'utilisateur (2026-11-01) être
 * exactement la position déjà codée "échelon 5" dans GRILLES.EXC_PROFS (indice 895) — aucune
 * nouvelle donnée d'indice nécessaire. Pas de report d'ancienneté (G11 du classeur : "Non" pour
 * toute échelle préfixée "EXC"). La grille d'arrivée reste EXC_PROFS elle-même (voir
 * nouvelleGrilleApresReclassement, qui gère déjà ce cas sans changement : .replace("HC_","EXC_")
 * est un no-op sur un code qui n'a pas ce préfixe). */
export const RECLASSEMENT_EXC_PROFS_VERS_CHEVRON: ReclassementRow[] = [{ cle: 40, echelonReclassement: 5, conservationAnciennete: false }];

/** Professeur de chaire supérieure, échelon "6-HEA2" (son seul échelon de départ pertinent ici) →
 * "7-HEB2" — confirmé par l'utilisateur (2026-11-01), table fournie directement et recoupée avec
 * Données!M58:P68 du classeur source (voir grilles.ts's GRILLES.CHAIRE_SUP). Pas de report
 * d'ancienneté (G11 du classeur exclut explicitement "CHAIRE_SUP"). `cle` n'a ici aucun rôle
 * ancienneté-dépendant — un seul échelon de départ existe, jamais interrogé numériquement
 * puisque le code d'échelon lui-même ("6-HEA2") n'est pas numérique (voir computeReclassementHcExc,
 * qui court-circuite la recherche par clé pour toute table à une seule ligne). */
export const RECLASSEMENT_CHAIRE_SUP_VERS_CHEVRON: ReclassementRow[] = [{ cle: 0, echelonReclassement: "7-HEB2", conservationAnciennete: false }];

/** Certifié/PLP/PEPS bi-admissible → Hors Classe — atterrit dans la grille HC_PROFS ordinaire (la
 * bi-admissibilité ne se prolonge pas en tant que grille Hors Classe distincte ; aucune
 * "reclassement_HC_BI_ADMISSIBLE_PROFS" n'existe dans le classeur, voir nouvelleGrilleApresReclassement). */
export const RECLASSEMENT_BI_ADMISSIBLE_PROFS_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 94, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 100, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 102.5, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 112.5, echelonReclassement: 5, conservationAnciennete: false },
];

export const RECLASSEMENT_PEGC_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 100, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 103, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 113, echelonReclassement: 5, conservationAnciennete: false },
];

export const RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE: ReclassementRow[] = [
  { cle: 30, echelonReclassement: 1, conservationAnciennete: true },
  { cle: 32, echelonReclassement: 2, conservationAnciennete: false },
  { cle: 40, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 42, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 50, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 52.5, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 60, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 70, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 73, echelonReclassement: 5, conservationAnciennete: false },
];

export const RECLASSEMENT_HC_PEGC_VERS_CLASSE_EXCEPTIONNELLE: ReclassementRow[] = [
  { cle: 30, echelonReclassement: 1, conservationAnciennete: false },
  { cle: 31, echelonReclassement: 1, conservationAnciennete: false },
  { cle: 40, echelonReclassement: 1, conservationAnciennete: false },
  { cle: 42.5, echelonReclassement: 1, conservationAnciennete: false },
  { cle: 50, echelonReclassement: 1, conservationAnciennete: true },
  { cle: 52.5, echelonReclassement: 2, conservationAnciennete: false },
  { cle: 60, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 62.5, echelonReclassement: 3, conservationAnciennete: false },
];

export const RECLASSEMENT_HC_AGR_VERS_CLASSE_EXCEPTIONNELLE: ReclassementRow[] = [
  { cle: 200, echelonReclassement: 1, conservationAnciennete: false },
  { cle: 300, echelonReclassement: 1, conservationAnciennete: true },
  { cle: 302.5, echelonReclassement: "A1", conservationAnciennete: false },
  { cle: 410, echelonReclassement: "A1", conservationAnciennete: true },
  { cle: 411, echelonReclassement: "A2", conservationAnciennete: false },
  { cle: 420, echelonReclassement: "A2", conservationAnciennete: true },
  { cle: 421, echelonReclassement: "A3", conservationAnciennete: false },
  { cle: 430, echelonReclassement: "A3", conservationAnciennete: true },
  { cle: 431, echelonReclassement: "B2", conservationAnciennete: false },
];

// ---------------------------------------------------------------------------
// Reclassement après concours (packages/domain/src/calculations/reclassementConcours.ts) —
// AUTO-EXTRACTED from the union's "260824_Reclassements.xls" (VBA/formula decompilation of its
// "Reclt concours & Reprise anc." and "Reclt concours HC et EXC" sheets, via oletools + a patched
// xlrd formula decompiler — same method as the reclassement HC/EXC tables above).
// ---------------------------------------------------------------------------

/** One row of the "Situations_avant_reclassement" table (sheet "Données", $A$2:$C$22): how a given
 * prior-service nature is weighted when reclassing after a concours — either a direct weighting
 * fraction ("Activités professionnelles" counts for 2/3 of its real duration), or a "coefficient
 * caractéristique" to convert via the ratio coefficientOrigine/coefficientCible (most service
 * natures: AECE, ATER, MA 1/2/3, Instituteur, etc). Kept as an exact numerateur/denominateur (not a
 * float) so the "coefficient de reclassement appliqué" can be displayed as an irreducible fraction
 * (see coefficientAppliqueFraction in reclassementConcours.ts) without any rounding drift between
 * what's computed and what's shown. */
export interface SituationServiceAnterieur {
  nature: string;
  ponderation: { mode: "ponderation"; numerateur: number; denominateur: number } | { mode: "coefficient"; coefficient: number };
}

export const SITUATIONS_AVANT_RECLASSEMENT: SituationServiceAnterieur[] = [
  { nature: "Activités professionnelles", ponderation: { mode: "ponderation", numerateur: 2, denominateur: 3 } },
  { nature: "AECE", ponderation: { mode: "coefficient", coefficient: 115 } },
  { nature: "AED - MI_SE - AESH", ponderation: { mode: "coefficient", coefficient: 100 } },
  { nature: "ATER", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "CE d'EPS", ponderation: { mode: "coefficient", coefficient: 115 } },
  { nature: "CERTIFIE, PE , PEPS, PLP -- CN", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "CERTIFIE, PEPS, PLP -- BI-ADMISSIBLE", ponderation: { mode: "coefficient", coefficient: 145 } },
  { nature: "Contractuel alternant", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "Enseignement hors-contrat", ponderation: { mode: "ponderation", numerateur: 2, denominateur: 3 } },
  { nature: "Enseignement public ou validé", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "Instituteur", ponderation: { mode: "coefficient", coefficient: 100 } },
  { nature: "MA 1", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "MA 2", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "MA 3", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "MD 1", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "MD 2", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "PEGC", ponderation: { mode: "coefficient", coefficient: 115 } },
  { nature: "Service national non pris en compte", ponderation: { mode: "ponderation", numerateur: 1, denominateur: 1 } },
  { nature: "Suppléant 1°D", ponderation: { mode: "coefficient", coefficient: 135 } },
  { nature: "Vacations dans le public", ponderation: { mode: "coefficient", coefficient: 135 } },
];

/** "Coefficient caractéristique" per grille (sheet "Données", "Grades_echelles" table, last
 * column) — the historical ratio used ONLY by reclassement-after-concours conversions
 * (reclassementConcours.ts), never by salary/indice calculations elsewhere in this package. */
export const COEFFICIENT_CARACTERISTIQUE: Partial<Record<GrilleCode, number>> = {
  AGR: 175,
  AECE: 115,
  PROFS: 135,
  HC_PROFS: 135,
  EXC_PROFS: 135,
  BI_ADM: 145,
  PEGC: 115,
  HC_PEGC: 115,
  EXC_PEGC: 115,
  INSTIT: 100,
  MA_1: 135,
  MA_2: 115,
  HC_AGR: 175,
  EXC_AGR: 175,
};
