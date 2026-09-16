import { prisma } from "./db.js";
import { computeBASeuils, type PromuBA } from "@spelc/domain";
import { parseZ2AGEA } from "@spelc/import";
import { computeBaRanking } from "./baRanking.js";

/**
 * Recomputes the auto-inferred BA seuils for a campagne from its own imported rectorat snapshots,
 * using the actual BA winners for each (grade, échelon départ) group — see computeBaRanking for
 * how those are determined (ranking each section against its own known BA headcount, since no
 * per-record marker reliably distinguishes confirmed-promoted from merely-eligible for BA).
 *
 * Never overwrites a `locked` row: that represents the union's own confirmed/corrected figure
 * (see routes/baSeuils.ts) and must survive a later re-import untouched.
 */
export async function recomputeBaSeuils(campagneId: string): Promise<void> {
  const snapshots = await prisma.teacherSnapshot.findMany({
    where: { campagneId, proTypePromotion: "BA", echelonActuel: { in: ["07", "09"] } },
  });

  const { winners } = computeBaRanking(snapshots);
  if (winners.size === 0) return;

  const promus: PromuBA[] = snapshots
    .filter((s) => winners.has(s.teacherId))
    .map((s) => ({
      grade: s.grade,
      echelonDepart: s.echelonActuel === "07" ? 6 : 8,
      barreme: s.avisEvaluation!,
      ancienneteGrade: s.ancienneteGrade!,
      ancienneteEchelon: s.ancienneteEchelon!,
      age: s.ageEncodedRectorat ? parseZ2AGEA(s.ageEncodedRectorat).annees : 0,
    }));

  const computed = computeBASeuils(promus);

  const existing = await prisma.baSeuil.findMany({ where: { campagneId } });
  const lockedKeys = new Set(existing.filter((s) => s.locked).map((s) => `${s.grade}|${s.echelonDepart}`));

  for (const seuil of computed) {
    if (lockedKeys.has(`${seuil.grade}|${seuil.echelonDepart}`)) continue;

    await prisma.baSeuil.upsert({
      where: { campagneId_grade_echelonDepart: { campagneId, grade: seuil.grade, echelonDepart: seuil.echelonDepart } },
      update: {
        nombrePromusBa: seuil.nombrePromusBA,
        minBareme: seuil.minBarreme,
        minAncienneteGrade: seuil.minAncienneteGrade,
        minAncienneteEchelon: seuil.minAncienneteEchelon,
        minAge: seuil.minAge,
      },
      create: {
        campagneId,
        grade: seuil.grade,
        echelonDepart: seuil.echelonDepart,
        nombrePromusBa: seuil.nombrePromusBA,
        minBareme: seuil.minBarreme,
        minAncienneteGrade: seuil.minAncienneteGrade,
        minAncienneteEchelon: seuil.minAncienneteEchelon,
        minAge: seuil.minAge,
      },
    });
  }
}
