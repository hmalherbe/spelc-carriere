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
 * For agrégés hors-classe and classe-exceptionnelle grilles (HC_AGR, EXC_AGR, EXC_PROFS), the
 * grille's own labels switch from plain numbers to letter codes ("A1"/"A2"/"A3"/"B1"/"B2"/"B3" —
 * the union's own naming, used e.g. by isEligibleClasseExceptionnelle) once the numeric échelons
 * run out, while the rectorat's PDF export keeps counting numerically past that point. Verified
 * against real HC_AGR data: échelons "04"/"05"/"06" in the rectorat file are exactly, and only,
 * "A1"/"A2"/"A3" in that order — a continuation of the grille's own numbering, not an independent
 * one — so this derives the same continuation for any grille shaped that way, instead of a
 * hand-maintained table per grille: take the highest plain-numeric échelon in the grille, then
 * keep counting for each letter-coded row IN THE GRILLE'S OWN LISTED ORDER (not by indice, which
 * ties for grilles with parallel tracks converging back together — e.g. EXC_AGR's "A3" and "B1"
 * share an indice — and not by following echelonSuivant links, which for the same reason can skip
 * a parallel track entirely).
 *
 * Returns {} for a grille with no letter-coded échelons (nothing to alias).
 */
export function deriveNumericEchelonAliases(
  grille: GrilleCode,
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): Record<string, string> {
  const rows = grilles[grille];
  const numericEchelons = rows.map((r) => r.echelon).filter((e): e is number => typeof e === "number");
  const letterEchelons = rows.map((r) => r.echelon).filter((e): e is string => typeof e === "string");
  if (letterEchelons.length === 0) return {};

  const maxNumeric = numericEchelons.length > 0 ? Math.max(...numericEchelons) : 0;
  const aliases: Record<string, string> = {};
  letterEchelons.forEach((code, i) => {
    aliases[String(maxNumeric + 1 + i).padStart(2, "0")] = code;
  });
  return aliases;
}

/**
 * Derives the échelon a teacher actually held (their departure point) from the value the rectorat
 * PDF export prints in its section header — "PROJET D'AVANCEMENT ECHELON : NN". That value is the
 * échelon the section's candidates are being projected INTO (their arrival), never their current
 * one — confirmed against the real 25 mars 2026 CCMA mailing: a section headed "05" contained a
 * teacher whose actual sent letter read "vous étiez à l'échelon 4 ... passage à l'échelon 5". The
 * parser and importer previously stored that header value directly as `echelonActuel`, silently
 * shifting every computed échelon, date and gain by one step for as long as the app has existed.
 *
 * Finds the grille row whose `echelonSuivant` equals `projectionEchelon` and returns that row's own
 * échelon — walking one step backward through the grille's actual sequence, rather than a naive
 * "-1", so it also works across the plain-numeric -> letter-code boundary (HC/EXC grilles, where
 * échelon 3 -> "A1" for instance). Throws if no such row exists (an unreachable projection échelon
 * is a data/mapping bug, not something to silently misreport).
 *
 * Known limitation: a few classe-exceptionnelle grilles (EXC_AGR, EXC_PROFS, EXC_PEGC) still carry
 * two parallel pre-2017-reform "vivier" rows that converge on the same échelonSuivant (e.g. both
 * "A3" and "B1" lead to "B2" in EXC_AGR) — ambiguous from the projection value alone, this returns
 * whichever of the two comes first in the grille's own row order. The "vivier 2" track (B1/B2/B3)
 * predates the current PPCR rules, so this shouldn't affect a teacher on a current-cycle export.
 */
export function deriveEchelonActuelFromProjection(
  grille: GrilleCode,
  projectionEchelon: EchelonCode,
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): EchelonCode {
  const target = normalizeEchelonKey(projectionEchelon);
  const predecessor = grilles[grille].find((r) => normalizeEchelonKey(r.echelonSuivant) === target);
  if (!predecessor) {
    throw new Error(`Aucun échelon de la grille ${grille} n'a pour échelon suivant "${projectionEchelon}"`);
  }
  return predecessor.echelon;
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
