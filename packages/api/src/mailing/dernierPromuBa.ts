import { prisma } from "../db.js";

export interface DernierPromuBa {
  bareme: number;
  ancienneteGrade: number;
  ancienneteEchelon: number;
}

function isLower(a: DernierPromuBa, b: DernierPromuBa): boolean {
  if (a.bareme !== b.bareme) return a.bareme < b.bareme;
  if (a.ancienneteGrade !== b.ancienneteGrade) return a.ancienneteGrade < b.ancienneteGrade;
  return a.ancienneteEchelon < b.ancienneteEchelon;
}

/**
 * For each (grade, échelon actuel) group in this campagne, the rectorat-confirmed BA winner with
 * the LOWEST (barème, ancienneté grade, ancienneté échelon) — i.e. the "just barely promoted" peer
 * the CCMA model letter shows a non-promu candidate, to explain the tie-break that separated them.
 *
 * This reuses the exact tie-break order the deleted baThreshold.ts (git history, commit caa40a1's
 * parent) inferred a selection cutoff from — but unlike that removed code, it never estimates
 * anyone's status: it only reports the real barème/ancienneté of a peer the rectorat has already
 * confirmed promoted ("Pro BA."), for transparency in the letter to someone who wasn't.
 */
export async function loadDernierPromuBaByGroup(campagneId: string): Promise<Map<string, DernierPromuBa>> {
  const promus = await prisma.teacherSnapshot.findMany({
    where: { campagneId, proTypePromotion: "BA", proConfirmee: true },
    select: { grade: true, echelonActuel: true, avisEvaluation: true, ancienneteGrade: true, ancienneteEchelon: true },
  });

  const byGroup = new Map<string, DernierPromuBa>();
  for (const p of promus) {
    if (p.avisEvaluation == null || p.ancienneteGrade == null || p.ancienneteEchelon == null) continue;
    const key = `${p.grade}|${p.echelonActuel}`;
    const candidate: DernierPromuBa = { bareme: p.avisEvaluation, ancienneteGrade: p.ancienneteGrade, ancienneteEchelon: p.ancienneteEchelon };
    const current = byGroup.get(key);
    if (!current || isLower(candidate, current)) byGroup.set(key, candidate);
  }
  return byGroup;
}
