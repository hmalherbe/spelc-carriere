import { prisma } from "./db.js";
import { computeEchelonPromotion, parseAncienneteText, GRADE_MAPPINGS, type GrilleCode, type EchelonRow } from "@spelc/domain";
import { deriveAncienneteAReporter } from "./ancienneteReportee.js";
import { computeBaStatus } from "./baStatus.js";

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
  /** Raw "AAaMMmJJj" text from Teacher.ancienneteAReporter (manual override), or null if unset —
   * REPLACES the automatic RE./CL.-marker derivation entirely when present (see that field's doc
   * comment in schema.prisma). */
  ancienneteAReporterManualRaw: string | null;
  proTypePromotion: string | null;
  proConfirmee: boolean;
  /** The rectorat's own confirmed date for this échelon change ("Pro AN./Pro BA.<date>" marker —
   * see TeacherSnapshot.dateProchainePromotionRectorat's own doc comment), when present. Always
   * takes priority over the date computeEchelonPromotion derives below — see this function's own
   * doc comment for why. */
  dateProchainePromotionRectorat: Date | null;
  ancienneteEchelon: number | null;
  /** Manually promoted via the union's own "reliquat" mechanism (schema.prisma's
   * ReliquatPromotion) — see baStatus.ts's own doc comment. Defaults to false. */
  reliquatPromu?: boolean;
  liveGrilles: Record<GrilleCode, EchelonRow[]>;
  liveValeurDuPoint: number;
}

/**
 * Computes one teacher's next-promotion projection for one campagne and upserts it into
 * ComputedPromotionState — the exact logic routes/imports.ts runs for every fresh snapshot at
 * import time, extracted here so routes/teachers.ts can re-run it on demand when an admin edits a
 * Teacher's ancienneteADeduire or ancienneteAReporter correction (see those fields' doc comments):
 * without this, either correction would silently only take effect on the NEXT rectorat reimport,
 * not immediately.
 *
 * The stored dateProchainePromotion always prefers the rectorat's own confirmed date
 * (dateProchainePromotionRectorat) over computeEchelonPromotion's own projection, for EVERY track
 * (AN/CL/RE/BA alike) — per explicit product decision (2026-10-10): the rectorat's own figure is
 * ground truth whenever it's stated, our own date math is only ever a placeholder for a record the
 * rectorat hasn't confirmed yet. Real case that forced this: Claudine BAUD (CERTIFIE EXC, échelon 4,
 * "RE. 00a11m05j" report d'ancienneté) — the rectorat's own "Pro AN.01/09/2025" is one real day
 * later than what computeEchelonPromotion derives (31/08/2025) from the same inputs. That 1-day gap
 * traces to an inherent mismatch between the 360-day "banking year" this engine uses for échelon
 * durations and the real Gregorian calendar the rectorat's own system presumably counts in — NOT a
 * one-line arithmetic bug: two OTHER real report-d'ancienneté cases from this exact campaign (Elise
 * MORIN, Charlotte BOURGEON — see ancienneteReportee.test.ts) already match the rectorat exactly
 * with the current formula, and every alternative order of operations tried to fix BAUD's case
 * broke one of those two instead. Rather than chase an approximation that can never be exact for
 * every case, this simply defers to the rectorat's own stated date whenever it has one — the other
 * computed fields (échelon suivant, indices, gain) are unaffected and stay exactly as computed.
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
      ancienneteAReporter: input.ancienneteAReporterManualRaw
        ? parseAncienneteText(input.ancienneteAReporterManualRaw)
        : deriveAncienneteAReporter(input.typePromotion, input.dureeRestante),
      ancienneteADeduire: parseAncienneteText(input.ancienneteADeduireRaw),
      grilles: input.liveGrilles,
      valeurDuPoint: input.liveValeurDuPoint,
    });

    // Same computeBaStatus() the live teacher list (routes/teachers.ts) and stats aggregates
    // (routes/stats.ts) already use — stored here too so the AI assistant's read-only SQL access
    // has a real, always-current field to query (see the column's own doc comment in schema.prisma).
    const { baStatus } = computeBaStatus({
      echelonActuel: input.echelonActuel,
      grade: input.grade,
      proTypePromotion: input.proTypePromotion,
      proConfirmee: input.proConfirmee,
      ancienneteEchelon: input.ancienneteEchelon,
      reliquatPromu: input.reliquatPromu,
    });

    const data = {
      grilleCode: promotion.grille,
      echelonDepart: String(promotion.echelonDepart),
      echelonSuivant: String(promotion.echelonSuivant),
      indiceActuel: promotion.indiceActuel,
      futurIndice: promotion.futurIndice,
      gainSalaireBrut: promotion.gainSalaireBrut,
      gainSalaireNet: promotion.gainSalaireNet,
      dateProchainePromotion: input.dateProchainePromotionRectorat ?? (promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null),
      baStatus,
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
