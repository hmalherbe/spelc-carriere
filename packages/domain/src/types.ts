import type { EchelonCode, GrilleCode } from "./data/grilles.js";

/** An "ancienneté" duration expressed the way the source spreadsheets store it: years/months/days on a 360-day banking calendar (12 months of 30 days each) rather than a real calendar — this matches how French administrative HR services compute échelon durations. */
export interface AncienneteYMD {
  annees: number;
  mois: number;
  jours: number;
}

export interface TeacherSnapshot {
  nom: string;
  prenom: string;
  dateNaissance?: string; // ISO date
  grade: string; // rectorat grade label, resolved via GRADE_MAPPINGS
  echelonDepart: EchelonCode;
  dateDernierChangementEchelon: string; // ISO date
  ancienneteADeduire?: AncienneteYMD;
  ancienneteAReporter?: AncienneteYMD;
  avis?: "Excellent" | "Très satisfaisant" | "Satisfaisant" | "A consolider" | null;
  barreme?: number; // 0-4 numeric avis, used for BA threshold ranking
}

export interface PromotionResult {
  grille: GrilleCode;
  echelonDepart: EchelonCode;
  echelonSuivant: EchelonCode;
  indiceActuel: number;
  futurIndice: number;
  ancienTraitementBrutMensuel: number;
  futurTraitementBrutMensuel: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  dateProchainePromotion: string | null; // ISO date, null if echelon is already "MAX"
}

/** A teacher who was actually promoted "au choix" (bonification d'ancienneté) at échelon 6 or 8 this campaign — the observed ground truth used to infer the selection threshold. */
export interface PromuBA {
  grade: string;
  echelonDepart: 6 | 8;
  barreme: number;
  ancienneteGrade: number; // in years, as a decimal
  ancienneteEchelon: number; // in years, as a decimal
  age: number; // encoded as YYMMJJ integer, matching the rectorat's own Z2AGEA encoding
}

/** The inferred selection threshold ("profile of the last promoted teacher") for one (grade, échelon départ) group, plus how many were promoted. */
export interface BASeuil {
  grade: string;
  echelonDepart: 6 | 8;
  nombrePromusBA: number;
  minBarreme: number;
  minAncienneteGrade: number;
  minAncienneteEchelon: number;
  minAge: number;
  /** true once a human has reviewed/locked this threshold instead of trusting the auto-inferred one (per product decision: "estimation auto + ajustement manuel") */
  locked?: boolean;
}
