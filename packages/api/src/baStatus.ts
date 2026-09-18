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
  // Compared as a number, not the raw string ("06" vs "6"), since echelonActuel now always holds
  // the teacher's own départ échelon (see deriveEchelonActuelFromProjection in @spelc/domain) rather
  // than the arrival échelon this used to key on before the échelon-off-by-one fix — a BA candidate
  // at échelon 6 is stored as "06"/"6" here, never "07" any more.
  const echelonNumber = Number(snap.echelonActuel);
  const baEchelonDepart: 6 | 8 | null = echelonNumber === 6 ? 6 : echelonNumber === 8 ? 8 : null;

  const baEligible =
    baEchelonDepart !== null && snap.ancienneteEchelon != null
      ? isEligibleBonificationAnciennete(baEchelonDepart, snap.ancienneteEchelon)
      : null;

  const isBaCandidate = baEchelonDepart !== null && snap.proTypePromotion === "BA";
  const isAgrege = snap.grade.startsWith("AGREGE");

  // proConfirmee ("Pro BA." on the record) and isAgrege (décision nationale, jamais tranchée par ce
  // fichier départemental) are both checked BEFORE baEligible — per the same "Pro BA. is final, not
  // an estimate to second-guess" rule this module's own doc comment states, never overridden by our
  // own window estimate. baEligible only decides between "hors_fenetre"/"non_promu" for a candidate
  // NOT (yet) confirmed. Real cases from the CCMA campaign of 25 mars 2026 (BRUNO, NIZET, MELVIN,
  // OLIVIERI, PARRA, BOTTON, EYMARD, BEZAC — all CERTIFIE, échelon 6, "Pro BA." confirmed) all carry
  // an ancienneté of 2.0 to 2.85 years at the point their promotion is confirmed — outside the [1, 2)
  // window isEligibleBonificationAnciennete checks for échelon 6 — proof the window is only a rough
  // candidacy estimate, not something a genuine rectorat confirmation should ever be discarded for:
  // gating "promu" behind baEligible made every one of these real, already-decided promotions show
  // as "hors_fenetre" instead.
  const baStatus: BaStatusResult["baStatus"] = !isBaCandidate
    ? null
    : isAgrege
      ? "national"
      : snap.proConfirmee
        ? "promu"
        : baEligible !== true
          ? "hors_fenetre"
          : "non_promu";

  const arrivedThisEchelon = isBaCandidate ? false : snap.proConfirmee;

  return { baEchelonDepart, baEligible, isBaCandidate, baStatus, arrivedThisEchelon };
}
