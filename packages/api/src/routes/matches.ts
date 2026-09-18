import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { matchUnresolvedAdherents } from "../adherentImport.js";

export const matchesRouter = Router();

matchesRouter.use(requireAuth);

/**
 * Per product decision: a confirmed link is permanent — this endpoint (and the queue it feeds)
 * only ever surfaces PENDING_REVIEW candidates, never re-litigates AUTO_CONFIRMED/CONFIRMED ones.
 *
 * Deliberately NOT filtered by campagne eligibility (whether the adherent is due for a promotion
 * in some campagne's period): matching an adhérent to the right enseignant is an identity question,
 * unrelated to promotion timing. An earlier version filtered by campagne here, which made a case
 * shown as "À vérifier" on the Dashboard (unfiltered) silently vanish from this queue whenever the
 * campagne-eligibility estimate said the adhérent wasn't due this period — or whenever that
 * estimate simply failed on incomplete grade/échelon data. Campagne-scoped due lists belong on the
 * "Adhérents éligibles" tab (routes/adherents.ts's /eligibles), which exists for exactly that.
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

/**
 * Manually re-runs matchUnresolvedAdherents() for every stuck/stale candidate in the DB, without
 * waiting for the next rectorat import (the only other trigger for it). Exists because a stale
 * suggestion made before a matching-rule tightened (e.g. the grade hard-filter) otherwise sits in
 * the queue until someone imports a new rectorat file — which can be weeks away — even though the
 * fix to clear it is already deployed.
 */
matchesRouter.post("/rescan", requireRole("ADMIN", "GESTIONNAIRE"), async (_req, res) => {
  const result = await matchUnresolvedAdherents();
  res.json(result);
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
