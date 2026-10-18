import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { matchUnresolvedAdherents, purgeStaleLowConfidenceMatches } from "../adherentImport.js";
import { normalizeGrade } from "@spelc/import";
import { computeAdherentEligibility } from "../adherentEligibility.js";

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
 * Optionally filtered by campagne eligibility (whether the adherent is due for a promotion in the
 * given campagne's period) via `campagneId` — opt-in, not the endpoint's own default, on purpose.
 * An earlier version filtered by campagne unconditionally here, which made a case shown as "À
 * vérifier" on the Dashboard (unfiltered) silently vanish from this queue whenever the
 * campagne-eligibility estimate said the adhérent wasn't due this period — or whenever that
 * estimate (computeAdherentEligibility, built from the adhérent's OWN possibly-stale ADEL
 * grade/échelon/date, since an unmatched adhérent has no rectorat data yet) simply failed on
 * incomplete data. Per explicit product decision, the web UI now defaults its Review Queue to
 * passing `campagneId` (so day-to-day review focuses on the current campagne), but always with a
 * visible way back to the unfiltered view — never a silent default at this endpoint's own level,
 * so nothing else calling this route inherits the same risk unless it opts in.
 *
 * Ce filtre calendaire ne s'applique QU'aux candidats sans suggestion concrète pour cette campagne
 * (voir le filtre ci-dessous) : une suggestion tirée du vrai fichier rectorat de cette campagne
 * n'a pas à être revalidée par une estimation qui peut se tromper (2026-10-18 — un adhérent
 * correctement rapproché à un enseignant de CETTE campagne disparaissait quand même de la file
 * parce que son estimation calendaire, basée sur SES propres données ADEL, disait "pas dû").
 */
matchesRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "PENDING_REVIEW";
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;

  const candidates = await prisma.matchCandidate.findMany({
    where: { status: status as never },
    include: {
      adherent: true,
      teacher: {
        include: {
          // La campagne d'où vient cette fiche : un Teacher persiste d'une année sur l'autre, donc
          // sa dernière fiche connue peut très bien dater d'une campagne (et d'une année scolaire)
          // différente de celle actuellement sélectionnée — voir ReviewQueuePage.tsx, qui l'affiche
          // pour éviter de laisser croire qu'un fichier rectorat existe déjà pour l'année en cours.
          snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" }, include: { campagne: { select: { anneeScolaire: true, commission: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!campagneId) return res.json(candidates);

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const filtered = candidates.filter((c) => {
    const suggestionCampagne = c.teacher?.snapshots[0]?.campagne;
    // Une suggestion dont la fiche enseignant vient bien de CETTE campagne (même année scolaire, et
    // même commission quand elle est connue des deux côtés) est une preuve concrète et directe de
    // pertinence — tirée du fichier rectorat réellement importé pour cette campagne, pas d'une
    // estimation. Elle doit toujours apparaître, SANS passer par le filtre calendaire ci-dessous :
    // celui-ci se base sur les données ADEL de l'adhérent (grade/échelon/date), potentiellement
    // incomplètes ou fausses pour un adhérent pas encore rapproché, et n'a pas de raison de
    // contredire une correspondance déjà trouvée dans les vraies données de cette campagne.
    if (
      c.teacherId &&
      suggestionCampagne &&
      suggestionCampagne.anneeScolaire === campagne.anneeScolaire &&
      (campagne.commission == null || suggestionCampagne.commission == null || suggestionCampagne.commission === campagne.commission)
    ) {
      return true;
    }

    // À partir d'ici : pas de suggestion concrète pour cette campagne (soit aucune suggestion du
    // tout, soit une suggestion issue d'une AUTRE année scolaire/commission). Le filtre calendaire
    // évite de noyer la file sous les adhérents pas encore dus — display-only, ne touche jamais le
    // MatchCandidate : une suggestion d'une autre année reste parfaitement valide pour SA propre
    // année, juste masquée ici. Voir matchUnresolvedAdherents's own doc comment pour l'incident
    // causé par un filtre équivalent appliqué à la donnée elle-même plutôt qu'à l'affichage
    // (2026-10-17). Toujours visible via "Afficher tous les adhérents...".
    if (!computeAdherentEligibility(c.adherent, campagne).eligible) return false;
    return true;
  });
  res.json(filtered);
});

/**
 * Manually re-runs matchUnresolvedAdherents() for every stuck/stale candidate in the DB, without
 * waiting for the next rectorat import (the only other trigger for it). Exists because a stale
 * suggestion made before a matching-rule tightened (e.g. the grade hard-filter) otherwise sits in
 * the queue until someone imports a new rectorat file — which can be weeks away — even though the
 * fix to clear it is already deployed.
 *
 * `campagneId` (the one selected in the Review Queue's own campagne picker) scopes the teacher pool
 * to that campagne's année scolaire, same as every other matchUnresolvedAdherents() call site — see
 * its own doc comment.
 *
 * Also runs purgeStaleLowConfidenceMatches() — a separate cleanup matchUnresolvedAdherents()
 * deliberately never does on its own (see that function's doc comment) — so raising
 * minSuggestionThreshold in Paramètres has a visible effect here, on demand, rather than only ever
 * applying to brand new suggestions.
 */
matchesRouter.post("/rescan", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const { campagneId } = req.body as { campagneId?: string };
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  const result = await matchUnresolvedAdherents(campagneId);
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
