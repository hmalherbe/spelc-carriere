import { prisma } from "./db.js";
import { computeEchelonPromotion, parseAncienneteText, GRADE_MAPPINGS, type GrilleCode, type EchelonRow } from "@spelc/domain";
import { deriveAncienneteAReporter } from "./ancienneteReportee.js";

export interface RecomputePromotionStateInput {
  teacherId: string;
  campagneId: string;
  grade: string;
  echelonActuel: string;
  dateAccesEchelon: Date;
  typePromotion: string | null;
  dureeRestante: string | null;
  /** Raw "AAaMMmJJj" text from Teacher.ancienneteADeduire, or null if no correction is set. */
  ancienneteADeduireRaw: string | null;
  liveGrilles: Record<GrilleCode, EchelonRow[]>;
  liveValeurDuPoint: number;
}

/**
 * Computes one teacher's next-promotion projection for one campagne and upserts it into
 * ComputedPromotionState — the exact logic routes/imports.ts runs for every fresh snapshot at
 * import time, extracted here so routes/teachers.ts can re-run it on demand when an admin edits a
 * Teacher's ancienneteADeduire correction (see that field's doc comment): without this, the
 * correction would silently only take effect on the NEXT rectorat reimport, not immediately.
 */
export async function recomputeAndStorePromotionState(
  input: RecomputePromotionStateInput,
): Promise<{ warning?: string }> {
  const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === input.grade);
  if (!gradeMapping) {
    return { warning: `Grade "${input.grade}" non reconnu dans GRADE_MAPPINGS` };
  }

  try {
    const promotion = computeEchelonPromotion({
      grille: gradeMapping.grille as GrilleCode,
      echelonDepart: input.echelonActuel,
      dateDernierChangementEchelon: input.dateAccesEchelon.toISOString().slice(0, 10),
      ancienneteAReporter: deriveAncienneteAReporter(input.typePromotion, input.dureeRestante),
      ancienneteADeduire: parseAncienneteText(input.ancienneteADeduireRaw),
      grilles: input.liveGrilles,
      valeurDuPoint: input.liveValeurDuPoint,
    });

    const data = {
      grilleCode: promotion.grille,
      echelonDepart: String(promotion.echelonDepart),
      echelonSuivant: String(promotion.echelonSuivant),
      indiceActuel: promotion.indiceActuel,
      futurIndice: promotion.futurIndice,
      gainSalaireBrut: promotion.gainSalaireBrut,
      gainSalaireNet: promotion.gainSalaireNet,
      dateProchainePromotion: promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
    };

    await prisma.computedPromotionState.upsert({
      where: { teacherId_campagneId: { teacherId: input.teacherId, campagneId: input.campagneId } },
      update: data,
      create: { teacherId: input.teacherId, campagneId: input.campagneId, ...data },
    });
    return {};
  } catch (e) {
    // Échelon introuvable dans la grille (donnée aberrante, ou grade mal détecté pour cette fiche) —
    // signalé à l'appelant plutôt que de faire échouer tout l'import/toute la mise à jour.
    return { warning: e instanceof Error ? e.message : String(e) };
  }
}
