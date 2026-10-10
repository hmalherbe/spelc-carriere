import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { computeAdherentEligibility } from "../adherentEligibility.js";

export const adherentsRouter = Router();
adherentsRouter.use(requireAuth);

/**
 * Every adherent due (CCMA/CCMI-eligible) for the given campagne — independent of matching status,
 * unlike /matches which only ever lists PENDING_REVIEW candidates. Flags whether each one is
 * actually backed by a rectorat snapshot for THIS campagne (`nonPresentDansRectorat`): a linked
 * teacher isn't enough on its own if that teacher's own rectorat data doesn't cover this specific
 * campagne (e.g. matched years ago, not re-imported since).
 *
 * A PENDING_REVIEW match still counts as "present" here as long as it carries a real teacherId with
 * a snapshot for this campagne — PENDING_REVIEW only means a human hasn't rubber-stamped the fuzzy
 * match yet, not that the underlying teacher link is wrong or that the rectorat doesn't have this
 * person. Real bug found this way: ABOUKASSEM Raghda (PLP, genuinely in the rectorat file) was
 * reported as absent from it purely because her match was still PENDING_REVIEW — an older version
 * of this check required CONFIRMED/AUTO_CONFIRMED, conflating "match reviewed by a human" with
 * "teacher present in the rectorat", and wrongly flagged the large majority of eligible adherents as
 * absent on a real campagne where most matches simply hadn't been manually reviewed yet. Only
 * REJECTED (a human explicitly declared the link wrong) is excluded — matches.ts's reject handler
 * sets that status without clearing teacherId, so it must be checked explicitly rather than inferred
 * from teacherId alone.
 */
adherentsRouter.get("/eligibles", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const adherents = await prisma.adherent.findMany({
    include: {
      matchCandidate: {
        include: {
          teacher: {
            include: {
              snapshots: { where: { campagneId }, take: 1 },
              computedStates: { where: { campagneId }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  const result = adherents
    .map((a) => {
      const eligibility = computeAdherentEligibility(a, campagne);
      if (!eligibility.eligible) return null;

      const snapshot = a.matchCandidate?.teacher?.snapshots[0];
      const presentDansRectorat = a.matchCandidate?.status !== "REJECTED" && a.matchCandidate?.teacherId != null && snapshot != null;

      // Once the rectorat actually has this person for this campagne, its own date is always the
      // right one to show — never the ADEL-based estimate computeAdherentEligibility produces from
      // the adhérent's own (possibly stale/approximate) ancienEchelon/dateEffet fields, which exists
      // only as a placeholder for someone NOT YET covered by any rectorat import. Same precedence
      // routes/teachers.ts already uses for a BA candidate: the rectorat's own confirmed marker
      // (TeacherSnapshot.dateProchainePromotionRectorat) first, since it can genuinely differ from a
      // generic duration-based projection (BA acceleration); the stored ComputedPromotionState
      // otherwise (already computed from the teacher's real dateAccesEchelon at import time). A real
      // null here (e.g. already at the grille's ceiling) is also correct to show as-is, never papered
      // over by falling back to the adhérent-side estimate.
      const computedState = a.matchCandidate?.teacher?.computedStates[0];
      const dateProchainePromotion = presentDansRectorat
        ? snapshot?.dateProchainePromotionRectorat ?? computedState?.dateProchainePromotion ?? null
        : eligibility.dateProchainePromotion;

      return {
        adherentId: a.id,
        nom: a.nom,
        prenom: a.prenom,
        grade: a.grade,
        degre: eligibility.degre,
        dateProchainePromotion,
        nonPresentDansRectorat: !presentDansRectorat,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  res.json(result);
});
