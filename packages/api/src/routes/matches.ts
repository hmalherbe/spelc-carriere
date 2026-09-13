import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { computeAdherentEligibility } from "../adherentEligibility.js";

export const matchesRouter = Router();

matchesRouter.use(requireAuth);

/**
 * Per product decision: a confirmed link is permanent — this endpoint (and the queue it feeds)
 * only ever surfaces PENDING_REVIEW candidates, never re-litigates AUTO_CONFIRMED/CONFIRMED ones.
 *
 * When campagneId is given, also restricted to adherents actually due (CCMA/CCMI-eligible) for
 * that campagne's period — otherwise every adherent ever imported piles up here forever, most of
 * them irrelevant to any campaign currently being worked on. Without campagneId, unfiltered (kept
 * for backward compatibility, not used by the app's own UI anymore).
 */
matchesRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "PENDING_REVIEW";
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;

  const candidates = await prisma.matchCandidate.findMany({
    where: { status: status as never },
    include: { adherent: true, teacher: { include: { snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" } } } } },
    orderBy: { createdAt: "asc" },
  });

  if (!campagneId) return res.json(candidates);

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const filtered = candidates.filter((c) => computeAdherentEligibility(c.adherent, campagne).eligible);
  res.json(filtered);
});

matchesRouter.post("/:id/confirm", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const { teacherId } = req.body as { teacherId?: string };
  const candidate = await prisma.matchCandidate.findUnique({ where: { id: req.params.id } });
  if (!candidate) return res.status(404).json({ error: "Candidat de rapprochement introuvable" });

  const resolvedTeacherId = teacherId ?? candidate.teacherId;
  if (!resolvedTeacherId) {
    return res.status(400).json({ error: "teacherId requis pour confirmer ce rapprochement" });
  }

  const updated = await prisma.matchCandidate.update({
    where: { id: req.params.id },
    data: {
      teacherId: resolvedTeacherId,
      status: "CONFIRMED",
      reviewedById: req.auth!.userId,
      reviewedAt: new Date(),
    },
  });
  res.json(updated);
});

matchesRouter.post("/:id/reject", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const candidate = await prisma.matchCandidate.findUnique({ where: { id: req.params.id } });
  if (!candidate) return res.status(404).json({ error: "Candidat de rapprochement introuvable" });

  const updated = await prisma.matchCandidate.update({
    where: { id: req.params.id },
    data: { status: "REJECTED", reviewedById: req.auth!.userId, reviewedAt: new Date() },
  });
  res.json(updated);
});
