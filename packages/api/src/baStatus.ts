import { isEligibleBonificationAnciennete } from "@spelc/domain";

export interface BaStatusInput {
  echelonActuel: string;
  grade: string;
  proTypePromotion: string | null;
  proConfirmee: boolean;
  ancienneteEchelon: number | null;
  /** Manually promoted via the union's own "reliquat" mechanism (leftover rounding on the 30%
   * quota, decided AFTER the rectorat file — see schema.prisma's ReliquatPromotion) — treated
   * exactly like proConfirmee=true for baStatus purposes, since it's just as final a decision, the
   * rectorat file simply never carries a marker for it. Defaults to false. */
  reliquatPromu?: boolean;
}

export interface BaStatusResult {
  baEchelonDepart: 6 | 8 | null;
  /** Purely informational (see isEligibleBonificationAnciennete's own doc comment) — never gates
   * baStatus below. Exposed only for display (DashboardPage/MailingPage don't currently use it, but
   * routes/teachers.ts still surfaces it). */
  baEligible: boolean | null;
  /** Carries the rectorat's own "BA" marker (proTypePromotion). Exposed for callers that still need
   * to gate other BA-specific logic (e.g. the échelon-display correction in routes/teachers.ts). */
  isBaCandidate: boolean;
  baStatus: "promu" | "non_promu" | null;
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

  // baStatus comes ENTIRELY from the rectorat's own markers now — never from baEligible (the
  // computed ancienneté window above). Per the union's explicit rule (confirmed 2026-10-13): a
  // candidate's real-world status is "BA.<date>" (unconfirmed) vs "Pro BA.<date>" (confirmed) as
  // printed in the rectorat file, full stop — not an estimate we second-guess it against. This
  // used to gate "non_promu" behind baEligible (a separate "hors_fenetre" status for a candidate
  // whose ancienneté fell outside isEligibleBonificationAnciennete's window), on the assumption that
  // such cases were stale/spurious "BA" markers rather than real candidates — confirmed WRONG by the
  // union on the campagne CCMA 2024-2025 (06/83) : 72 of its 97 échelon-6/8 BA candidates landed
  // "hors_fenetre" this way and vanished from the Reliquats/Enseignants pages entirely, even though
  // the rectorat file's own "BA.<date>" marker plainly listed every one of them as a real candidate.
  // "hors_fenetre" is gone — every unconfirmed BA-marked candidate is "non_promu" now, regardless of
  // ancienneteEchelon. (The same loosening already applied to "promu" via the BRUNO/NIZET/MELVIN/...
  // real cases below, which already proved baEligible was only ever a rough estimate.)
  //
  // proConfirmee ("Pro BA." on the record) still wins outright over everything else — a rectorat
  // confirmation is final, never second-guessed. Real cases from the CCMA campaign of 25 mars 2026
  // (BRUNO, NIZET, MELVIN, OLIVIERI, PARRA, BOTTON, EYMARD, BEZAC — all CERTIFIE, échelon 6, "Pro
  // BA." confirmed) all carry an ancienneté of 2.0 to 2.85 years — outside the [1, 2) window
  // isEligibleBonificationAnciennete checks for échelon 6.
  //
  // Agrégés used to be forced to "national" here (BA décidée au ministère, jamais tranchable par ce
  // fichier départemental) — confirmed obsolete by the union (2026-10-09): la BA des agrégés se
  // décide désormais directement au niveau académique, comme pour tout autre grade, sans remontée
  // nationale. Le marqueur "Pro BA." du rectorat tranche donc promu/non-promu pour eux aussi.
  //
  // reliquatPromu compte exactement comme proConfirmee ici — une promotion par reliquat est une
  // décision tout aussi définitive, simplement absente du fichier rectorat (voir le commentaire du
  // champ lui-même). Real case: Yann ADAM, AGREGE, échelon 6, pas de "Pro BA." dans le fichier
  // rectorat du 25 mars 2026, promu quand même par reliquat.
  const isConfirmedOrReliquat = snap.proConfirmee || snap.reliquatPromu === true;
  const baStatus: BaStatusResult["baStatus"] = !isBaCandidate ? null : isConfirmedOrReliquat ? "promu" : "non_promu";

  const arrivedThisEchelon = isBaCandidate ? false : snap.proConfirmee;

  return { baEchelonDepart, baEligible, isBaCandidate, baStatus, arrivedThisEchelon };
}
