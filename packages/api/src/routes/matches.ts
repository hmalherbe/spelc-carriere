import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const matchesRouter = Router();

matchesRouter.use(requireAuth);

/**
 * Per product decision: a confirmed link is permanent — this endpoint (and the queue it feeds)
 * only ever surfaces PENDING_REVIEW candidates, never re-litigates AUTO_CONFIRMED/CONFIRMED ones.
 */
matchesRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "PENDING_REVIEW";
  const candidates = await prisma.matchCandidate.findMany({
    where: { status: status as never },
    include: { adherent: true, teacher: { include: { snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" } } } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(candidates);
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
