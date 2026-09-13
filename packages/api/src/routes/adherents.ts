import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { computeAdherentEligibility } from "../adherentEligibility.js";

export const adherentsRouter = Router();
adherentsRouter.use(requireAuth);

/**
 * Every adherent due (CCMA/CCMI-eligible) for the given campagne — independent of matching status,
 * unlike /matches which only ever lists PENDING_REVIEW candidates. Flags whether each one is
 * actually backed by a rectorat snapshot for THIS campagne (`nonPresentDansRectorat`): a confirmed
 * or auto-confirmed link to a teacher isn't enough on its own if that teacher's own rectorat data
 * doesn't cover this specific campagne (e.g. matched years ago, not re-imported since).
 */
adherentsRouter.get("/eligibles", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const adherents = await prisma.adherent.findMany({
    include: {
      matchCandidate: {
        include: { teacher: { include: { snapshots: { where: { campagneId }, take: 1 } } } },
      },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  const result = adherents
    .map((a) => {
      const eligibility = computeAdherentEligibility(a, campagne);
      if (!eligibility.eligible) return null;

      const presentDansRectorat =
        (a.matchCandidate?.status === "CONFIRMED" || a.matchCandidate?.status === "AUTO_CONFIRMED") &&
        (a.matchCandidate.teacher?.snapshots.length ?? 0) > 0;

      return {
        adherentId: a.id,
        nom: a.nom,
        prenom: a.prenom,
        grade: a.grade,
        degre: eligibility.degre,
        dateProchainePromotion: eligibility.dateProchainePromotion,
        nonPresentDansRectorat: !presentDansRectorat,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  res.json(result);
});
