import { GRILLES, type EchelonCode, type EchelonRow, type GrilleCode } from "../data/grilles.js";
import { VALEUR_DU_POINT } from "../data/refs.js";

/**
 * Numeric échelons are compared without leading zeros, since the rectorat's PDF exports print
 * them zero-padded (e.g. "06") while the grille data stores plain numbers (6). Non-numeric codes
 * (hors classe / classe exceptionnelle échelons like "A1", "B2") are compared as-is.
 */
function normalizeEchelonKey(echelon: EchelonCode): string {
  const s = String(echelon);
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}

/**
 * Equivalent of the spreadsheet's `VLOOKUP(echelon, INDIRECT(grille), col, FALSE)`.
 * Throws if the échelon doesn't exist in that grille — a missing échelon is a data/mapping bug,
 * not something to silently paper over, since it would silently produce a wrong salary.
 *
 * `grilles` defaults to the built-in reference tables but can be overridden with a "live" copy
 * (e.g. loaded from the database) so an admin's edits to the indice grid take effect — see
 * packages/api/src/liveGrilles.ts, the only real caller of that override.
 */
export function findEchelonRow(
  grille: GrilleCode,
  echelon: EchelonCode,
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): EchelonRow {
  const row = grilles[grille].find((r) => normalizeEchelonKey(r.echelon) === normalizeEchelonKey(echelon));
  if (!row) {
    throw new Error(`Échelon ${echelon} introuvable dans la grille ${grille}`);
  }
  return row;
}

/**
 * Gross monthly salary ("traitement brut mensuel") for a given indice.
 * Mirrors: TEXT(ROUND(indice * Valeur_du_point / 12, 0), "0000")
 *
 * `valeurDuPoint` defaults to the built-in reference value but can be overridden with the current
 * value from the database (it's revalued periodically by the government) — see
 * packages/api/src/liveGrilles.ts.
 */
export function traitementBrutMensuel(indice: number, valeurDuPoint: number = VALEUR_DU_POINT): number {
  return Math.round((indice * valeurDuPoint) / 12);
}

/**
 * Gross monthly gain from a promotion, computed as the difference of two independently-rounded
 * monthly salaries (this rounding order matters and must match the spreadsheet exactly, since
 * rounding first then subtracting can differ by 1€ from subtracting then rounding).
 * Mirrors: Futur_Traitement_brut - Ancien_Traitement_brut_mensuel
 */
export function gainSalaireBrut(indiceActuel: number, futurIndice: number, valeurDuPoint: number = VALEUR_DU_POINT): number {
  return traitementBrutMensuel(futurIndice, valeurDuPoint) - traitementBrutMensuel(indiceActuel, valeurDuPoint);
}

/**
 * Net monthly gain from a promotion. Unlike the brut calculation, this is NOT the difference of
 * two rounded net salaries — the spreadsheet computes it directly from the indice delta, applying
 * a flat 0.77 net/brut ratio (an approximation of employee social contributions for teachers, not
 * a payslip-accurate net computation).
 * Mirrors: ROUND((Futur_Indice - Indice_actuel) * Valeur_du_point * 0.77 / 12, 0)
 */
export function gainSalaireNet(indiceActuel: number, futurIndice: number, valeurDuPoint: number = VALEUR_DU_POINT): number {
  return Math.round(((futurIndice - indiceActuel) * valeurDuPoint * 0.77) / 12);
}
