import { prisma } from "../db.js";

/**
 * Per (grade, échelon actuel) group in this campagne: how many teachers were BA candidates this
 * cycle, whether ultimately granted or not. Combined with TeacherSnapshot.nombrePromusBaSection
 * (the rectorat's own promoted count for the same group), this gives the promotion rate the CCMA
 * model letter shows a non-promu candidate — computed live rather than typed by hand each campaign.
 *
 * "Was a candidate" uses the exact same OR condition as deriveBonification.ts (typePromotion==="BA"
 * OR proTypePromotion==="BA") — a base "AN" marker with a pending/confirmed "BA" proTypePromotion
 * is still a real candidate (see Joe MANSOUN, a real case from the 25 mars 2026 CCMA mailing: his
 * typePromotion is "AN" but proTypePromotion is "BA" — filtering on typePromotion alone excluded
 * him from his own group's denominator, undercounting it and wrongly zeroing out the percentage).
 */
export async function loadBaCandidateCountByGroup(campagneId: string): Promise<Map<string, number>> {
  const candidates = await prisma.teacherSnapshot.findMany({
    where: { campagneId, OR: [{ typePromotion: "BA" }, { proTypePromotion: "BA" }] },
    select: { grade: true, echelonActuel: true },
  });
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = `${c.grade}|${c.echelonActuel}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
