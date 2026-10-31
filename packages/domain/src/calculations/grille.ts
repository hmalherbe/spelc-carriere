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
 * 1-based position of `echelon` in `grille`'s own échelon sequence (1er échelon -> 1, 2e -> 2, peu
 * importe que la grille code ses derniers échelons en lettres — ex. EXC_PROFS: "1".."5" puis "A2",
 * "A3" -> rangs 6, 7 ; HC_AGR: "1".."3" puis "A1".."A3" -> rangs 4, 5, 6). Permet aux calculs de
 * reclassement (reclassementConcours.ts) de raisonner sur une position plutôt que sur le code brut
 * de l'échelon, qui n'est pas toujours numérique. Throws si l'échelon n'existe pas dans la grille —
 * même logique que `findEchelonRow`.
 */
export function rangEchelon(grille: GrilleCode, echelon: EchelonCode, grilles: Record<GrilleCode, EchelonRow[]> = GRILLES): number {
  const idx = grilles[grille].findIndex((r) => normalizeEchelonKey(r.echelon) === normalizeEchelonKey(echelon));
  if (idx < 0) {
    throw new Error(`Échelon ${echelon} introuvable dans la grille ${grille}`);
  }
  return idx + 1;
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
 *
 * Excludes a grille's own ceiling row from the search: its `duree === "MAX"` row always has
 * `echelonSuivant === echelon` (a self-loop — there's no échelon beyond it), which would otherwise
 * also satisfy `echelonSuivant === target` for a projection landing ON that ceiling and could be
 * matched instead of the real predecessor depending on row order — confirmed as a real production
 * bug (HC_PROFS's échelon 7 ceiling: a teacher genuinely promoted 6 -> 7 this cycle, with "PROJET
 * D'AVANCEMENT ECHELON : 07", was derived back to échelonActuel "07" instead of "06" whenever the
 * grille rows weren't returned in ascending échelon order — e.g. loadLiveGrilles' unordered
 * `prisma.grille.findMany`, where DB row order isn't guaranteed — silently reporting them as having
 * already reached the grille's ceiling instead of the promotion they were actually getting this CCMA).
 */
export function deriveEchelonActuelFromProjection(
  grille: GrilleCode,
  projectionEchelon: EchelonCode,
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): EchelonCode {
  const target = normalizeEchelonKey(projectionEchelon);
  const predecessor = grilles[grille].find(
    (r) => normalizeEchelonKey(r.echelonSuivant) === target && normalizeEchelonKey(r.echelon) !== target,
  );
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

/**
 * Classes a total ancienneté (in banking days) into the échelon it lands on within a grille's own
 * NUMERIC échelons, plus the report (remaining days past that échelon's own threshold) — used by
 * reclassement-after-concours calculations (reclassementConcours.ts) to turn a reconstructed
 * ancienneté total into a landing échelon, the same way the central spreadsheet's own
 * `Duree_cumulee_echelons_<grille>` cumulative-threshold tables do (derived here from each row's
 * own `duree`, in years, rather than hand-maintained as a separate table).
 * Stops at the grille's own numeric ceiling (its highest numeric échelon) — never returns a
 * lettered échelon (hors-classe/classe-exceptionnelle grilles only reclassent into a classe-normale
 * grille's numeric range via this path).
 */
export function classerParAncienneteJours(
  grille: GrilleCode,
  ancienneteJours: number,
  grilles: Record<GrilleCode, EchelonRow[]> = GRILLES,
): { echelon: number; reportJours: number } {
  const rows = grilles[grille].filter((r): r is EchelonRow & { echelon: number } => typeof r.echelon === "number");
  let echelon = rows[0]?.echelon ?? 1;
  let seuil = 0;
  let cumul = 0;
  for (const row of rows) {
    if (cumul > ancienneteJours) break;
    echelon = row.echelon;
    seuil = cumul;
    if (row.duree === "MAX") break;
    cumul += row.duree * 360;
  }
  return { echelon, reportJours: ancienneteJours - seuil };
}

/**
 * Cumulative banking days needed to REACH a given numeric échelon in a grille — the "threshold"
 * `classerParAncienneteJours` walks internally, exposed standalone for reclassement-after-concours
 * calculations (reclassementConcours.ts) that need a specific échelon's own threshold rather than
 * classing an ancienneté total (e.g. "Situation 1" of Reclt concours & reprise d'ancienneté: the
 * base jours for a service already AT a known échelon in its own corps d'origine's grille).
 */
export function seuilEntreeEchelon(grille: GrilleCode, echelon: number, grilles: Record<GrilleCode, EchelonRow[]> = GRILLES): number {
  let cumul = 0;
  for (const row of grilles[grille]) {
    if (row.echelon === echelon) return cumul;
    if (row.duree === "MAX") break;
    cumul += row.duree * 360;
  }
  throw new Error(`Échelon numérique ${echelon} introuvable dans la grille ${grille}`);
}

/**
 * Cumulative banking days accrued THROUGH the end of a given numeric échelon (i.e. the threshold
 * to enter the NEXT échelon) — the complement of `seuilEntreeEchelon` above, which gives the
 * threshold to enter `echelon` itself. For the grille's ceiling échelon (duree "MAX"), equals
 * `seuilEntreeEchelon(echelon)` itself since there's no further échelon to accrue into.
 *
 * This is what the union's own classeur's "AGR"/"PROFS" tables (Données!A45:E55 etc., column E,
 * read via `VLOOKUP(échelon, AGR, 5, TRUE)`) actually store — confirmed by reading the real cell
 * values directly from the source .xls (not just the formula text): row "échelon 8" holds 6480
 * (18 years, cumulative THROUGH échelon 8), not 5220 (14.5 years, the threshold to ENTER échelon
 * 8 that `seuilEntreeEchelon(grille, 8)` returns). `baseTheoriqueJours` in reclassementConcours.ts
 * (Cas "Reclt concours HC et EXC") needs this exact convention, confirmed by a real-case mismatch
 * (2026-10-31): Certifié HC échelon 1 → the classeur's "Base théorique d'équivalence" is 6480j,
 * not 5220j, exactly `seuilFinEchelon("AGR", 8)`.
 */
export function seuilFinEchelon(grille: GrilleCode, echelon: number, grilles: Record<GrilleCode, EchelonRow[]> = GRILLES): number {
  let cumul = 0;
  for (const row of grilles[grille]) {
    cumul += row.duree === "MAX" ? 0 : row.duree * 360;
    if (row.echelon === echelon) return cumul;
  }
  throw new Error(`Échelon numérique ${echelon} introuvable dans la grille ${grille}`);
}
