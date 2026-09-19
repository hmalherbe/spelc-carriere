import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { matchUnresolvedAdherents, purgeStaleLowConfidenceMatches } from "../adherentImport.js";
import { normalizeGrade } from "@spelc/import";

export const matchesRouter = Router();

matchesRouter.use(requireAuth);

/**
 * Surfaces the actual size of the two pools being matched — added because "pourquoi autant
 * d'Aucune correspondance ?" kept coming up, and the real answer is usually structural rather than
 * a matching-algorithm problem: the rectorat CCMA files imported so far only cover the teachers up
 * for promotion review in the campaign(s) actually imported, not the whole union membership, so
 * most adherents have no counterpart at all to match against yet, regardless of how good the fuzzy
 * matching is. `adherentsWithNoGradeInPool` counts adherents whose grade doesn't appear even ONCE
 * among all imported teacher snapshots — i.e. structurally impossible to match, no matter the
 * threshold — as distinct from adherents whose grade DOES have candidates but none close enough by
 * name (a real matching-quality question, not a data-coverage one).
 */
matchesRouter.get("/stats", async (_req, res) => {
  const totalAdherents = await prisma.adherent.count();
  const teacherSnapshots = await prisma.teacherSnapshot.findMany({
    distinct: ["teacherId"],
    select: { teacherId: true, grade: true },
  });
  const totalTeachers = teacherSnapshots.length;
  const teacherGradeSet = new Set(teacherSnapshots.filter((t) => t.grade).map((t) => normalizeGrade(t.grade!)));

  const adherentGrades = await prisma.adherent.groupBy({ by: ["grade"], _count: { _all: true } });
  const adherentsWithNoGradeInPool = adherentGrades
    .filter((g) => g.grade && !teacherGradeSet.has(normalizeGrade(g.grade)))
    .reduce((sum, g) => sum + g._count._all, 0);
  const adherentsWithUnknownGrade = adherentGrades.filter((g) => !g.grade).reduce((sum, g) => sum + g._count._all, 0);

  res.json({ totalAdherents, totalTeachers, adherentsWithNoGradeInPool, adherentsWithUnknownGrade });
});

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
 *
 * Also runs purgeStaleLowConfidenceMatches() — a separate cleanup matchUnresolvedAdherents()
 * deliberately never does on its own (see that function's doc comment) — so raising
 * minSuggestionThreshold in Paramètres has a visible effect here, on demand, rather than only ever
 * applying to brand new suggestions.
 */
matchesRouter.post("/rescan", requireRole("ADMIN", "GESTIONNAIRE"), async (_req, res) => {
  const result = await matchUnresolvedAdherents();
  const { cleared } = await purgeStaleLowConfidenceMatches();
  res.json({ ...result, clearedLowConfidence: cleared });
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
