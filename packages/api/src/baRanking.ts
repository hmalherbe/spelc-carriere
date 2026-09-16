import { rankBACandidates, isEligibleBonificationAnciennete, type BACandidateRanked } from "@spelc/domain";
import { parseZ2AGEA } from "@spelc/import";

export interface BaRankableSnapshot {
  teacherId: string;
  grade: string;
  echelonActuel: string;
  proTypePromotion: string | null;
  avisEvaluation: number | null;
  ancienneteGrade: number | null;
  ancienneteEchelon: number | null;
  ageEncodedRectorat: string | null;
  nombrePromusBaSection: number | null;
}

export interface BaRankingResult {
  /** teacherIds ranked into the top nombrePromusBaSection — actually promoted this cycle. */
  winners: Set<string>;
  /** teacherIds whose (grade, échelon départ) group had complete data to rank at all — the
   * complement (a BA candidate NOT in this set) means "couldn't tell", not "lost". */
  rankable: Set<string>;
}

/**
 * Ranks every BA-candidate snapshot (proTypePromotion === "BA", on the rectorat's "07"/"09"
 * arrival page — see routes/teachers.ts for why that page is the départ-6/8 candidacy) by
 * (grade, échelon départ) group, using each group's own nombrePromusBaSection count straight from
 * the rectorat file's "NOMBRE DE PROMUS" footer, and the same tie-break order as
 * estimateAgainstSeuil (barème desc, ancienneté grade desc, ancienneté échelon desc, age asc — see
 * rankBACandidates in @spelc/domain).
 *
 * This exists because a per-record "confirmed" marker is NOT reliable for BA specifically: on a
 * real file, the two candidates actually granted the bonification carried no distinguishing prefix
 * at all — only their barème ranking set them apart from the rest of the section. Ranking the full
 * section against the section's own known headcount is the only reliable way to know who made it.
 *
 * Only ÉLIGIBLE candidates enter the ranking pool — per the union's own rule, a "BA" marker alone
 * isn't enough: ancienneté must also fall in the official window (isEligibleBonificationAnciennete)
 * — verified on a real file where two candidates carried a "BA" marker with 3.00 years' ancienneté
 * (well past the 1.5-2.5 year window for échelon 8, and matching a plain completed-full-duration AN
 * case instead), and would otherwise have been wrongly ranked as winners.
 */
export function computeBaRanking(snapshots: BaRankableSnapshot[]): BaRankingResult {
  const winners = new Set<string>();
  const rankable = new Set<string>();

  const groups = new Map<string, BaRankableSnapshot[]>();
  for (const s of snapshots) {
    if (s.proTypePromotion !== "BA") continue;
    const baEchelonDepart = s.echelonActuel === "07" ? 6 : s.echelonActuel === "09" ? 8 : undefined;
    if (baEchelonDepart === undefined) continue;
    if (s.ancienneteEchelon == null || !isEligibleBonificationAnciennete(baEchelonDepart, s.ancienneteEchelon)) continue;
    const key = `${s.grade}|${baEchelonDepart}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  for (const [key, group] of groups) {
    const baEchelonDepart = Number(key.split("|")[1]) as 6 | 8;
    const nombrePromusBA = group[0].nombrePromusBaSection;
    const allComplete = group.every(
      (s) =>
        nombrePromusBA != null &&
        s.nombrePromusBaSection === nombrePromusBA &&
        s.avisEvaluation != null &&
        s.ancienneteGrade != null &&
        s.ancienneteEchelon != null &&
        s.ageEncodedRectorat != null,
    );
    if (!allComplete || nombrePromusBA == null) continue;

    const candidates: BACandidateRanked[] = group.map((s) => ({
      id: s.teacherId,
      grade: s.grade,
      echelonDepart: baEchelonDepart,
      barreme: s.avisEvaluation!,
      ancienneteGrade: s.ancienneteGrade!,
      ancienneteEchelon: s.ancienneteEchelon!,
      age: parseZ2AGEA(s.ageEncodedRectorat!).annees,
    }));
    const groupWinners = rankBACandidates(candidates, nombrePromusBA);
    for (const s of group) {
      rankable.add(s.teacherId);
      if (groupWinners.has(s.teacherId)) winners.add(s.teacherId);
    }
  }

  return { winners, rankable };
}
