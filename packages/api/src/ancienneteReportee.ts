import { parseAncienneteText, type AncienneteYMD } from "@spelc/domain";

/**
 * Converts the rectorat's "durée restante" column into a credited ancienneté to feed
 * computeEchelonPromotion's `ancienneteAReporter` (which shortens the wait for the next échelon) —
 * but only when typePromotion marks the record as a report d'ancienneté ("RE.") or a reclassement
 * ("CL."). For "AN" (passage normal) or "BA" (bonification, whose date comes straight from the
 * rectorat's own "BA."/"Pro BA." marker instead — see routes/teachers.ts) the same column, even
 * when present, doesn't carry this meaning and must not be subtracted.
 *
 * Verified against two real cases from the CCMA campaign of 25 mars 2026: Elise MORIN (AGREGE,
 * "CL. 01a04m24j", dateAccesEchelon 2025-09-01)
 * reproduces the rectorat's own confirmed "Pro AN.07/04/2026" exactly once this value is fed in as
 * ancienneteAReporter; Charlotte BOURGEON (AGREGE, "RE. 00a05m15j", dateAccesEchelon 2023-09-01)
 * reproduces "Pro AN.16/03/2026" the same way. Before this, the column was parsed and stored on
 * every snapshot but never passed to the date-calculation engine at all — every échelon-change date
 * for a RE./CL. record was silently computed as if there were nothing to credit.
 */
export function deriveAncienneteAReporter(typePromotion: string | null, dureeRestante: string | null): AncienneteYMD | null {
  if (typePromotion !== "RE" && typePromotion !== "CL") return null;
  return parseAncienneteText(dureeRestante);
}
