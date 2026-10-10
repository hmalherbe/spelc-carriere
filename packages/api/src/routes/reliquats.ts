import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { computeBaStatus } from "../baStatus.js";
import { recomputeAndStorePromotionState } from "../promotionState.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";

export const reliquatsRouter = Router();
reliquatsRouter.use(requireAuth);

/**
 * The eligible pool for a reliquat promotion: BA candidates (échelon 6 or 8) the RECTORAT file
 * alone leaves "non_promu" — computed here with reliquatPromu deliberately left false, so a
 * teacher doesn't vanish from the list the moment they're selected (their LIVE baStatus becomes
 * "promu" once selected — see baStatus.ts — which would otherwise make them impossible to
 * unselect). `selected` carries the real, current reliquat state instead.
 */
reliquatsRouter.get("/:campagneId", asyncHandler(async (req, res) => {
  const { campagneId } = req.params;
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const [snapshots, reliquats] = await Promise.all([
    prisma.teacherSnapshot.findMany({ where: { campagneId } }),
    prisma.reliquatPromotion.findMany({ where: { campagneId }, select: { teacherId: true } }),
  ]);
  const selectedTeacherIds = new Set(reliquats.map((r) => r.teacherId));

  const groups = new Map<
    string,
    {
      grade: string;
      echelon: 6 | 8;
      candidates: {
        teacherId: string;
        nom: string;
        prenom: string;
        bareme: number | null;
        ancienneteGrade: number | null;
        ancienneteEchelon: number | null;
        dateEligibiliteBA: string | null;
        selected: boolean;
      }[];
    }
  >();

  for (const snap of snapshots) {
    const { baEchelonDepart, baStatus } = computeBaStatus({
      echelonActuel: snap.echelonActuel,
      grade: snap.grade,
      proTypePromotion: snap.proTypePromotion,
      proConfirmee: snap.proConfirmee,
      ancienneteEchelon: snap.ancienneteEchelon,
      reliquatPromu: false,
    });
    if (baStatus !== "non_promu" || baEchelonDepart == null) continue;

    const key = `${snap.grade}|${baEchelonDepart}`;
    if (!groups.has(key)) groups.set(key, { grade: snap.grade, echelon: baEchelonDepart, candidates: [] });
    groups.get(key)!.candidates.push({
      teacherId: snap.teacherId,
      nom: snap.nomUsage,
      prenom: snap.prenom,
      bareme: snap.avisEvaluation,
      ancienneteGrade: snap.ancienneteGrade,
      ancienneteEchelon: snap.ancienneteEchelon,
      dateEligibiliteBA: snap.dateProchainePromotionRectorat ? snap.dateProchainePromotionRectorat.toISOString() : null,
      selected: selectedTeacherIds.has(snap.teacherId),
    });
  }

  const result = Array.from(groups.values())
    .map((g) => ({ ...g, candidates: g.candidates.sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom)) }))
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.echelon - b.echelon);

  res.json({ campagneId, groups: result });
}));

/** Recomputes ComputedPromotionState for this teacher+campagne with the given reliquat state —
 * shared by the select/unselect endpoints below so the stored baStatus column (see
 * ComputedPromotionState's own doc comment) never lags behind a reliquat toggle. */
async function recomputeAfterReliquatChange(teacherId: string, campagneId: string, reliquatPromu: boolean): Promise<void> {
  const snap = await prisma.teacherSnapshot.findFirst({ where: { teacherId, campagneId } });
  if (!snap) return;
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);
  await recomputeAndStorePromotionState({
    teacherId,
    campagneId,
    grade: snap.grade,
    echelonActuel: snap.echelonActuel,
    dateAccesEchelon: snap.dateAccesEchelon,
    typePromotion: snap.typePromotion,
    dureeRestante: snap.dureeRestante,
    ancienneteADeduireRaw: teacher?.ancienneteADeduire ?? null,
    ancienneteAReporterManualRaw: teacher?.ancienneteAReporter ?? null,
    proTypePromotion: snap.proTypePromotion,
    proConfirmee: snap.proConfirmee,
    dateProchainePromotionRectorat: snap.dateProchainePromotionRectorat,
    ancienneteEchelon: snap.ancienneteEchelon,
    reliquatPromu,
    liveGrilles,
    liveValeurDuPoint,
  });
}

const toggleSchema = z.object({ campagneId: z.string().min(1), teacherId: z.string().min(1) });

reliquatsRouter.post("/", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  const { campagneId, teacherId } = parsed.data;

  await prisma.reliquatPromotion.upsert({
    where: { campagneId_teacherId: { campagneId, teacherId } },
    update: {},
    create: { campagneId, teacherId, createdById: req.auth!.userId },
  });
  await recomputeAfterReliquatChange(teacherId, campagneId, true);
  res.status(201).json({ ok: true });
}));

reliquatsRouter.delete("/:campagneId/:teacherId", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const { campagneId, teacherId } = req.params;
  await prisma.reliquatPromotion.deleteMany({ where: { campagneId, teacherId } });
  await recomputeAfterReliquatChange(teacherId, campagneId, false);
  res.json({ ok: true });
}));
