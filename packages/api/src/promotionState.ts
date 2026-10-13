import { prisma } from "./db.js";
import { computeEchelonPromotion, parseAncienneteText, addCalendarYMD, GRADE_MAPPINGS, type GrilleCode, type EchelonRow } from "@spelc/domain";
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
 * The stored dateProchainePromotion prefers the rectorat's own confirmed date
 * (dateProchainePromotionRectorat) over computeEchelonPromotion's own projection, for every AN/CL/RE
 * track — per explicit product decision (2026-10-10): the rectorat's own figure is ground truth
 * whenever it's stated, our own date math is only ever a placeholder for a record the rectorat
 * hasn't confirmed yet. Real case that forced this: Claudine BAUD (CERTIFIE EXC, échelon 4,
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
 *
 * BA (bonification d'ancienneté) is the one case needing its own derivation, but STILL from the
 * rectorat's own stated date alone — never computeEchelonPromotion's grille-based recompute, which
 * the union has explicitly reiterated (2026-10-13) must never be the source for any teacher's
 * dateProchainePromotion, in any case. A BA candidate not (yet) granted it — computeBaStatus's
 * "non_promu" — has a dateProchainePromotionRectorat that is the HYPOTHETICAL
 * accelerated date printed next to the rectorat's raw, unconfirmed "BA.<date>" marker, not this
 * teacher's real next promotion: without the bonification, that falls exactly 1 calendar year later
 * (the whole point of a bonification "d'un an") — added directly onto the rectorat's own date, never
 * computeEchelonPromotion's own projection. Real case that first forced the "don't just reuse the
 * rectorat's raw BA date outright" half of this rule: a CCMI non-promu candidate shown eligible at
 * 05/02/2026 whose letter nonetheless announced that exact same date as their real next promotion
 * instead of 05/02/2027. Real case that then forced the "+1 year on the rectorat's date, NOT the
 * grille recompute" half: Jan-César NATAF (CERTIFIE, échelon 6, dateAccesEchelon 2017-09-01, "RE.
 * 01a04m16j" report d'ancienneté, rectorat's own "BA.15/04/2025") — computeEchelonPromotion's
 * recompute from his old access date + that report credit lands on 15/04/2019, nonsensically in the
 * past by the time the letter is sent; confirmed by the union that his real next promotion (BA not
 * granted) is 15/04/2026 — exactly the rectorat's own BA date plus 1 year, confirming the grille
 * recompute must never enter into it. A granted BA (proConfirmee or reliquatPromu — baStatus "promu")
 * keeps using the rectorat's own date as-is: that one IS real, the accelerated date having actually
 * been decided.
 */
export function resolveDateProchainePromotion(
  baStatus: ReturnType<typeof computeBaStatus>["baStatus"],
  dateProchainePromotionRectorat: Date | null,
  computedDate: Date | null,
): Date | null {
  if (baStatus === "non_promu") {
    if (!dateProchainePromotionRectorat) return null;
    const isoDate = dateProchainePromotionRectorat.toISOString().slice(0, 10);
    return new Date(addCalendarYMD(isoDate, { annees: 1, mois: 0, jours: 0 }));
  }
  return dateProchainePromotionRectorat ?? computedDate;
}

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

    const dateProchainePromotion = resolveDateProchainePromotion(
      baStatus,
      input.dateProchainePromotionRectorat,
      promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
    );

    const data = {
      grilleCode: promotion.grille,
      echelonDepart: String(promotion.echelonDepart),
      echelonSuivant: String(promotion.echelonSuivant),
      indiceActuel: promotion.indiceActuel,
      futurIndice: promotion.futurIndice,
      gainSalaireBrut: promotion.gainSalaireBrut,
      gainSalaireNet: promotion.gainSalaireNet,
      dateProchainePromotion,
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
