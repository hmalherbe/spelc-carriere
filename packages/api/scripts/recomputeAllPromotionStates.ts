/**
 * One-off: re-runs recomputeAndStorePromotionState for every existing TeacherSnapshot — needed
 * after either of two fixes to this project's BA logic, to apply them to every campagne already
 * imported rather than just future ones:
 *   - promotionState.ts's dateProchainePromotion logic (see that file's own doc comment) — a BA
 *     candidate NOT granted the bonification (baStatus "non_promu") was wrongly shown the
 *     rectorat's hypothetical ACCELERATED date instead of their real next promotion (exactly 1 year
 *     later, on the grille's normal schedule).
 *   - baStatus.ts's "hors_fenetre" removal (2026-10-13) — a candidate whose ancienneté fell outside
 *     isEligibleBonificationAnciennete's window used to get that separate, downgraded status
 *     instead of "non_promu", silently excluding them from the Reliquats/Enseignants pages. Running
 *     this re-labels every stored ComputedPromotionState.baStatus still at "hors_fenetre" to
 *     "non_promu" (and recomputes its dateProchainePromotion the same way as any other non_promu).
 * Harmless to re-run: every other computed field is recomputed identically.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/recomputeAllPromotionStates.ts
 */
import { PrismaClient } from "@prisma/client";
import { recomputeAndStorePromotionState } from "../src/promotionState.js";
import { loadReliquatPromotionsByCampagne } from "../src/reliquats.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../src/liveGrilles.js";

const prisma = new PrismaClient();

async function main() {
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

  const snapshots = await prisma.teacherSnapshot.findMany({
    include: { teacher: { select: { ancienneteADeduire: true, ancienneteAReporter: true } } },
  });
  console.log(`${snapshots.length} TeacherSnapshot à recalculer.`);

  const reliquatByCampagne = new Map<string, Set<string>>();
  let recomputed = 0;
  let warnings = 0;

  for (const snap of snapshots) {
    let reliquatTeacherIds = reliquatByCampagne.get(snap.campagneId);
    if (!reliquatTeacherIds) {
      reliquatTeacherIds = await loadReliquatPromotionsByCampagne(snap.campagneId);
      reliquatByCampagne.set(snap.campagneId, reliquatTeacherIds);
    }

    const { warning } = await recomputeAndStorePromotionState({
      teacherId: snap.teacherId,
      campagneId: snap.campagneId,
      grade: snap.grade,
      echelonActuel: snap.echelonActuel,
      dateAccesEchelon: snap.dateAccesEchelon,
      typePromotion: snap.typePromotion,
      dureeRestante: snap.dureeRestante,
      ancienneteADeduireRaw: snap.teacher.ancienneteADeduire,
      ancienneteAReporterManualRaw: snap.teacher.ancienneteAReporter,
      proTypePromotion: snap.proTypePromotion,
      proConfirmee: snap.proConfirmee,
      dateProchainePromotionRectorat: snap.dateProchainePromotionRectorat,
      ancienneteEchelon: snap.ancienneteEchelon,
      reliquatPromu: reliquatTeacherIds.has(snap.teacherId),
      liveGrilles,
      liveValeurDuPoint,
    });
    recomputed++;
    if (warning) {
      warnings++;
      console.log(`  [avertissement] ${snap.nomUsage} ${snap.prenom} (${snap.campagneId}) : ${warning}`);
    }
  }

  console.log(`\nFait : ${recomputed} recalculé(s), ${warnings} avertissement(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
