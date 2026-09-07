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
  { grade: "MA 1", grille: "MA_1", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
  { grade: "MA 2", grille: "MA_2", degre: 1, accesHorsClasse: false, accesClasseExceptionnelle: false },
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
 * Points d'ancienneté pour l'accès à la hors classe.
 * key = échelon*10 + ancienneté dans l'échelon (ex: échelon 9, 2 ans d'ancienneté -> clé 92)
 */
export const POINTS_ANCIENNETE_HC: { cle: number; points: number }[] = [
  { cle: 92, points: 0 }, { cle: 93, points: 10 }, { cle: 100, points: 20 }, { cle: 101, points: 30 },
  { cle: 102, points: 40 }, { cle: 103, points: 50 }, { cle: 110, points: 60 }, { cle: 111, points: 70 },
  { cle: 112, points: 80 }, { cle: 113, points: 100 }, { cle: 114, points: 110 }, { cle: 115, points: 120 },
  { cle: 116, points: 130 }, { cle: 117, points: 140 }, { cle: 118, points: 150 }, { cle: 119, points: 160 },
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

export const RECLASSEMENT_PROFS_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 100, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 102.5, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 4, conservationAnciennete: true },
  { cle: 112.5, echelonReclassement: 5, conservationAnciennete: false },
];

export const RECLASSEMENT_AGR_VERS_HORS_CLASSE: ReclassementRow[] = [
  { cle: 92, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 100, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 102, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 110, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 113, echelonReclassement: "A1", conservationAnciennete: false },
];

export const RECLASSEMENT_HC_PROFS_VERS_CLASSE_EXCEPTIONNELLE: ReclassementRow[] = [
  { cle: 30, echelonReclassement: 1, conservationAnciennete: true },
  { cle: 32, echelonReclassement: 2, conservationAnciennete: false },
  { cle: 40, echelonReclassement: 2, conservationAnciennete: true },
  { cle: 42, echelonReclassement: 3, conservationAnciennete: false },
  { cle: 50, echelonReclassement: 3, conservationAnciennete: true },
  { cle: 52.5, echelonReclassement: 4, conservationAnciennete: false },
  { cle: 60, echelonReclassement: 4, conservationAnciennete: true },
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
