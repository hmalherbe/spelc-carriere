import { isEligibleBonificationAnciennete } from "@spelc/domain";

export interface BaStatusInput {
  echelonActuel: string;
  grade: string;
  proTypePromotion: string | null;
  proConfirmee: boolean;
  ancienneteEchelon: number | null;
}

export interface BaStatusResult {
  baEchelonDepart: 6 | 8 | null;
  baEligible: boolean | null;
  /** Carries the rectorat's own "BA" marker (proTypePromotion) on an arrival page — as opposed to
   * baEligible, which is window-only per the union's rule. Exposed for callers that still need to
   * gate other BA-specific logic (e.g. the échelon-display correction in routes/teachers.ts). */
  isBaCandidate: boolean;
  baStatus: "hors_fenetre" | "national" | "promu" | "non_promu" | null;
  /** Did this record actually ARRIVE at a new échelon this cycle? Always false for a BA candidate
   * (confirmed or not) — see the long comment in routes/teachers.ts this was extracted from. */
  arrivedThisEchelon: boolean;
}

/**
 * The BA (bonification d'ancienneté) candidacy/status logic, extracted out of routes/teachers.ts
 * so routes/stats.ts can aggregate over the exact same rule without re-deriving it (and risking it
 * drifting out of sync) — see routes/teachers.ts for the full rationale behind each rule below.
 */
export function computeBaStatus(snap: BaStatusInput): BaStatusResult {
  const baEchelonDepart: 6 | 8 | null = snap.echelonActuel === "07" ? 6 : snap.echelonActuel === "09" ? 8 : null;

  const baEligible =
    baEchelonDepart !== null && snap.ancienneteEchelon != null
      ? isEligibleBonificationAnciennete(baEchelonDepart, snap.ancienneteEchelon)
      : null;

  const isBaCandidate = baEchelonDepart !== null && snap.proTypePromotion === "BA";
  const isAgrege = snap.grade.startsWith("AGREGE");

  const baStatus: BaStatusResult["baStatus"] = !isBaCandidate
    ? null
    : baEligible !== true
      ? "hors_fenetre"
      : isAgrege
        ? "national"
        : snap.proConfirmee
          ? "promu"
          : "non_promu";

  const arrivedThisEchelon = isBaCandidate ? false : snap.proConfirmee;

  return { baEchelonDepart, baEligible, isBaCandidate, baStatus, arrivedThisEchelon };
}
