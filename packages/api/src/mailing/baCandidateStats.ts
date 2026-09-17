import { prisma } from "../db.js";

/**
 * Per (grade, échelon actuel) group in this campagne: how many teachers were BA candidates this
 * cycle (typePromotion === "BA", whether ultimately granted or not). Combined with
 * TeacherSnapshot.nombrePromusBaSection (the rectorat's own promoted count for the same group),
 * this gives the promotion rate the CCMA model letter shows a non-promu candidate — computed live
 * rather than typed by hand into the letter each campaign.
 */
export async function loadBaCandidateCountByGroup(campagneId: string): Promise<Map<string, number>> {
  const candidates = await prisma.teacherSnapshot.findMany({
    where: { campagneId, typePromotion: "BA" },
    select: { grade: true, echelonActuel: true },
  });
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = `${c.grade}|${c.echelonActuel}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
