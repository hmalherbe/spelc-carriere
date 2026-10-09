import { prisma } from "./db.js";

/**
 * Teachers manually promoted via the union's own "reliquat" mechanism for this campagne — see
 * schema.prisma's ReliquatPromotion doc comment for what a reliquat is and why the rectorat file
 * never carries a marker for it. Used wherever computeBaStatus()/deriveBonification() need to
 * treat a reliquat exactly like a rectorat-confirmed "Pro BA." (routes/teachers.ts, routes/
 * stats.ts, routes/mailing.ts, promotionState.ts).
 */
export async function loadReliquatPromotionsByCampagne(campagneId: string): Promise<Set<string>> {
  const rows = await prisma.reliquatPromotion.findMany({ where: { campagneId }, select: { teacherId: true } });
  return new Set(rows.map((r) => r.teacherId));
}

/**
 * Reliquat promotions for this campagne, counted per (grade, échelon actuel) group — the same key
 * shape as baCandidateStats.ts's loadBaCandidateCountByGroup, so routes/mailing.ts can add this
 * count on top of the rectorat's own TeacherSnapshot.nombrePromusBaSection when computing the
 * "seuls X % des promouvables..." percentage shown to a non-promu colleague in the same group —
 * without it, a reliquat promotion would silently lower that percentage for everyone else instead
 * of raising it to reflect reality.
 */
export async function loadReliquatCountByGroup(campagneId: string): Promise<Map<string, number>> {
  const reliquats = await prisma.reliquatPromotion.findMany({ where: { campagneId }, select: { teacherId: true } });
  if (reliquats.length === 0) return new Map();

  const snapshots = await prisma.teacherSnapshot.findMany({
    where: { campagneId, teacherId: { in: reliquats.map((r) => r.teacherId) } },
    select: { grade: true, echelonActuel: true },
  });

  const counts = new Map<string, number>();
  for (const s of snapshots) {
    const key = `${s.grade}|${s.echelonActuel}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
