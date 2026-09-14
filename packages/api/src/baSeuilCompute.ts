import { prisma } from "./db.js";
import { computeBASeuils, type PromuBA } from "@spelc/domain";
import { parseZ2AGEA } from "@spelc/import";

/**
 * Recomputes the auto-inferred BA seuils for a campagne from its own imported rectorat snapshots.
 *
 * The rectorat's "ECHELON : NN" pages group every record by the échelon it would ARRIVE at this
 * cycle (see routes/teachers.ts). A record's "TRACK.date" marker (proTypePromotion) names BA for
 * every candidate in the running, whether or not they were actually granted it — only proConfirmee
 * (a "Pro "-prefixed marker, i.e. "Promu") means the rectorat has actually decided in their favor.
 * So a snapshot with proTypePromotion "BA" AND proConfirmee true, on the "07" (resp "09") page, IS
 * a teacher actually promoted this cycle via bonification d'ancienneté départ-échelon 6 (resp 8):
 * exactly the PromuBA population computeBASeuils needs to reverse-engineer this campagne's cutoff
 * — feeding it the full (confirmed + merely eligible) candidate pool instead would derive the
 * threshold from the weakest CANDIDATE rather than the weakest actual PROMU, understating it.
 *
 * Never overwrites a `locked` row: that represents the union's own confirmed/corrected figure
 * (see routes/baSeuils.ts) and must survive a later re-import untouched.
 */
export async function recomputeBaSeuils(campagneId: string): Promise<void> {
  const snapshots = await prisma.teacherSnapshot.findMany({
    where: {
      campagneId,
      proTypePromotion: "BA",
      proConfirmee: true,
      echelonActuel: { in: ["07", "09"] },
      avisEvaluation: { not: null },
      ancienneteGrade: { not: null },
      ancienneteEchelon: { not: null },
      ageEncodedRectorat: { not: null },
    },
  });

  const promus: PromuBA[] = snapshots.map((s) => ({
    grade: s.grade,
    echelonDepart: s.echelonActuel === "07" ? 6 : 8,
    barreme: s.avisEvaluation!,
    ancienneteGrade: s.ancienneteGrade!,
    ancienneteEchelon: s.ancienneteEchelon!,
    age: parseZ2AGEA(s.ageEncodedRectorat!).annees,
  }));

  if (promus.length === 0) return;

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
