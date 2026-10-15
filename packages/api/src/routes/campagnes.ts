import { Router } from "express";
import { z } from "zod";
import type { CampagneType, Commission, CampagneNature } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const campagnesRouter = Router();

/**
 * Derives (nature, commission) from a campagne's `type` — the one axis `type` always determines —
 * plus, for an HC/EXC campagne only, an explicit `commissionInput` the caller may supply (since
 * `type: "HC"`/`type: "EXC"` alone can't say which commission runs it — see Campagne.commission's
 * own doc comment in schema.prisma). For CCMA/CCMI, `commissionInput` is ignored outright: the
 * commission is the type itself, never a separate choice.
 */
export function deriveCommissionNature(
  type: CampagneType,
  commissionInput?: Commission | null,
): { nature: CampagneNature; commission: Commission | null } {
  if (type === "CCMA" || type === "CCMI") {
    return { nature: "ECHELON", commission: type };
  }
  return { nature: type, commission: commissionInput ?? null };
}

/**
 * The 6 (commission, nature) slots a complete "année scolaire" covers — the union's own ask (voir
 * l'étude de faisabilité "année scolaire comme entité de premier niveau", 2026-10-15) : une CCMA et
 * une CCMI d'avancement d'échelon, plus une CCMA et une CCMI pour chacune de HC et EXC. Order here
 * is purely the order createAnneeScolaire below creates them in — doesn't drive anything else.
 */
export const ANNEE_SCOLAIRE_SLOTS: { commission: Commission; nature: CampagneNature }[] = [
  { commission: "CCMA", nature: "ECHELON" },
  { commission: "CCMI", nature: "ECHELON" },
  { commission: "CCMA", nature: "HC" },
  { commission: "CCMA", nature: "EXC" },
  { commission: "CCMI", nature: "HC" },
  { commission: "CCMI", nature: "EXC" },
];

/** The `type` a given slot maps to — inverse of deriveCommissionNature: ECHELON's type IS the
 * commission itself, HC/EXC's type is the nature itself (commission is the extra info `type` alone
 * never carried for those two — see Campagne.commission's own doc comment in schema.prisma). */
export function campagneTypeForSlot(slot: { commission: Commission; nature: CampagneNature }): CampagneType {
  return slot.nature === "ECHELON" ? slot.commission : slot.nature;
}

campagnesRouter.use(requireAuth);

campagnesRouter.get("/", async (_req, res) => {
  // periodeDebut alone leaves ties unresolved: several campagnes for the same année scolaire (test
  // campagnes, a redone CCMA/CCMI split, ...) commonly share the exact same start date, and without
  // a secondary key the DB is free to return them in any order — including a different one on every
  // request. DashboardPage.tsx defaults its campagne selector to the FIRST entry here, so an
  // unstable tie order meant the dashboard could silently default to a stale campagne even right
  // after importing into the intended one, with no visible sign anything was wrong. createdAt desc
  // breaks the tie deterministically in favor of the most recently created campagne.
  const campagnes = await prisma.campagne.findMany({
    orderBy: [{ periodeDebut: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { teacherSnapshots: true, imports: true } } },
  });
  res.json(campagnes);
});

const createCampagneSchema = z.object({
  anneeScolaire: z.string().min(1),
  periodeDebut: z.string().datetime().or(z.string().date()),
  periodeFin: z.string().datetime().or(z.string().date()),
  dateCcma: z.string().datetime().or(z.string().date()),
  // CCMA/CCMI (échelon advancement) or HC/EXC (Hors Classe/Classe Exceptionnelle) — required for
  // every new campagne. For CCMA/CCMI it decides which élus (see Elu) are inserted in every
  // mailing sent for it (routes/mailing.ts); HC/EXC campagnes instead accept HC/EXC "Tableau
  // Avancement" imports (see routes/imports.ts's /hc-exc) and reject the échelon-import routes.
  // Existing campagnes created before this field existed keep it null until set via PATCH below.
  type: z.enum(["CCMA", "CCMI", "HC", "EXC"]),
  // Only meaningful (and optional) when type is HC/EXC — see deriveCommissionNature's own doc
  // comment. Ignored outright for CCMA/CCMI, whose commission is the type itself.
  commission: z.enum(["CCMA", "CCMI"]).optional(),
});

campagnesRouter.post("/", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = createCampagneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { anneeScolaire, periodeDebut, periodeFin, dateCcma, type, commission: commissionInput } = parsed.data;
  const { nature, commission } = deriveCommissionNature(type, commissionInput);
  const campagne = await prisma.campagne.create({
    data: {
      anneeScolaire,
      periodeDebut: new Date(periodeDebut),
      periodeFin: new Date(periodeFin),
      dateCcma: new Date(dateCcma),
      type,
      nature,
      commission,
    },
  });
  res.status(201).json(campagne);
});

const createAnneeScolaireSchema = z.object({
  anneeScolaire: z.string().min(1),
  periodeDebut: z.string().datetime().or(z.string().date()),
  periodeFin: z.string().datetime().or(z.string().date()),
});

/**
 * Creates every one of the 6 ANNEE_SCOLAIRE_SLOTS campagnes for a given année scolaire in one call
 * — the "Nouvelle année scolaire" button in the header selector (Layout.tsx), instead of an admin
 * creating CCMA, then CCMI, then CCMA-HC, etc. one at a time across two different pages as before.
 * Idempotent/safe to re-run: a slot already covered by an existing campagne for this anneeScolaire
 * (matched on commission+nature, set for every campagne since the 2026-10-14 migration) is skipped,
 * never duplicated — so this also works to "fill in the gaps" for an année scolaire only partially
 * created today (e.g. only CCMA/CCMI échelon exist so far).
 *
 * No `dateCcma` here (confirmed by the union, 2026-10-15) : each commission's CCMA/CCMI meeting
 * date is always decided separately — there is no single shared "date de référence" to ask for up
 * front, only 6 dates to fill in once each is actually known. `periodeDebut` is used as a harmless
 * placeholder (same convention as routes/imports.ts's own dateAccesEchelon fallback) — every
 * created campagne genuinely needs its own real date set afterward via the existing PATCH /:id
 * (ImportPage's "Modifier les dates" / HorsClasseExceptionnellePage's own equivalent), same as any
 * other post-creation date fix.
 */
campagnesRouter.post("/annee-scolaire", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = createAnneeScolaireSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { anneeScolaire, periodeDebut, periodeFin } = parsed.data;

  const existing = await prisma.campagne.findMany({ where: { anneeScolaire } });

  const created: Awaited<ReturnType<typeof prisma.campagne.create>>[] = [];
  const skipped: { commission: Commission; nature: CampagneNature }[] = [];
  for (const slot of ANNEE_SCOLAIRE_SLOTS) {
    const alreadyExists = existing.some((c) => c.commission === slot.commission && c.nature === slot.nature);
    if (alreadyExists) {
      skipped.push(slot);
      continue;
    }
    const campagne = await prisma.campagne.create({
      data: {
        anneeScolaire,
        periodeDebut: new Date(periodeDebut),
        periodeFin: new Date(periodeFin),
        dateCcma: new Date(periodeDebut),
        type: campagneTypeForSlot(slot),
        commission: slot.commission,
        nature: slot.nature,
      },
    });
    created.push(campagne);
  }

  res.status(201).json({ created, skipped });
});

// Every field but all optional — a PATCH only updates whatever it includes, so the same route
// serves both "set the commission on a legacy campagne" (just `type`) and "fix a campagne's own
// dates after creation" (e.g. a wrong dateCcma that was only noticed once mailings referencing it
// had already gone out — see MailingPage/ccmaModelTemplate.ts, which read dateCcma straight from
// the campagne with no other way to correct it short of this endpoint).
const updateCampagneSchema = z.object({
  anneeScolaire: z.string().min(1).optional(),
  periodeDebut: z.string().datetime().or(z.string().date()).optional(),
  periodeFin: z.string().datetime().or(z.string().date()).optional(),
  dateCcma: z.string().datetime().or(z.string().date()).optional(),
  type: z.enum(["CCMA", "CCMI", "HC", "EXC"]).optional(),
  // See createCampagneSchema's own comment — same rule, plus it can also be patched on its own
  // (type unchanged) to split an already-existing HC/EXC campagne by commission after the fact.
  commission: z.enum(["CCMA", "CCMI"]).optional(),
});

campagnesRouter.patch("/:id", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = updateCampagneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const existing = await prisma.campagne.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Campagne introuvable" });

  const { anneeScolaire, periodeDebut, periodeFin, dateCcma, type, commission: commissionInput } = parsed.data;

  // A standalone `commission` patch (type unchanged) only makes sense for an HC/EXC campagne — a
  // CCMA/CCMI (nature ECHELON) campagne's commission IS its type, never a separate choice (see
  // deriveCommissionNature's own doc comment).
  if (type === undefined && commissionInput !== undefined && existing.nature === "ECHELON") {
    return res.status(400).json({
      error: "La commission d'une campagne CCMA/CCMI d'avancement d'échelon est son propre type — elle ne se change pas séparément.",
    });
  }

  let natureUpdate: CampagneNature | undefined;
  let commissionUpdate: Commission | null | undefined;
  if (type !== undefined) {
    const derived = deriveCommissionNature(type, commissionInput ?? existing.commission);
    natureUpdate = derived.nature;
    commissionUpdate = derived.commission;
  } else if (commissionInput !== undefined) {
    commissionUpdate = commissionInput;
  }

  const campagne = await prisma.campagne.update({
    where: { id: req.params.id },
    data: {
      ...(anneeScolaire !== undefined ? { anneeScolaire } : {}),
      ...(periodeDebut !== undefined ? { periodeDebut: new Date(periodeDebut) } : {}),
      ...(periodeFin !== undefined ? { periodeFin: new Date(periodeFin) } : {}),
      ...(dateCcma !== undefined ? { dateCcma: new Date(dateCcma) } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(natureUpdate !== undefined ? { nature: natureUpdate } : {}),
      ...(commissionUpdate !== undefined ? { commission: commissionUpdate } : {}),
    },
  });
  res.json(campagne);
});

/**
 * Permanently deletes a campagne and every piece of data tied to it: imports, teacher/HC-EXC
 * snapshots, computed promotion states, contingents, reliquats, mailing logs. A Teacher this
 * campagne's own data touched is deleted too, but ONLY if this campagne was its sole remaining data
 * — a teacher who also appears in another, still-existing campagne (and their adherent match,
 * manual ancienneté corrections, civilité override...) must survive untouched. Irreversible: no
 * confirmation at this layer, the caller (ImportPage.tsx) is expected to have already warned the
 * admin before calling this.
 */
campagnesRouter.delete("/:id", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const campagneId = req.params.id;
  const existing = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!existing) return res.status(404).json({ error: "Campagne introuvable" });

  await prisma.$transaction(async (tx) => {
    const touchedTeacherIds = new Set<string>();
    for (const s of await tx.teacherSnapshot.findMany({ where: { campagneId }, select: { teacherId: true } })) touchedTeacherIds.add(s.teacherId);
    for (const s of await tx.hcExcSnapshot.findMany({ where: { campagneId }, select: { teacherId: true } })) touchedTeacherIds.add(s.teacherId);

    await tx.mailingLog.deleteMany({ where: { campagneId } });
    await tx.reliquatPromotion.deleteMany({ where: { campagneId } });
    // No @relation on ComputedPromotionState.campagneId (see schema.prisma) — still campagne-scoped
    // data, deleted explicitly rather than left as orphaned rows pointing at a gone campagneId.
    await tx.computedPromotionState.deleteMany({ where: { campagneId } });
    await tx.contingent.deleteMany({ where: { campagneId } });
    await tx.teacherSnapshot.deleteMany({ where: { campagneId } });
    await tx.hcExcSnapshot.deleteMany({ where: { campagneId } });
    await tx.rectoratImport.deleteMany({ where: { campagneId } });

    if (touchedTeacherIds.size > 0) {
      const teacherIds = [...touchedTeacherIds];
      const [remainingSnapshots, remainingHcExc] = await Promise.all([
        tx.teacherSnapshot.findMany({ where: { teacherId: { in: teacherIds } }, select: { teacherId: true } }),
        tx.hcExcSnapshot.findMany({ where: { teacherId: { in: teacherIds } }, select: { teacherId: true } }),
      ]);
      const stillReferencedIds = new Set([...remainingSnapshots, ...remainingHcExc].map((s) => s.teacherId));
      const orphanTeacherIds = teacherIds.filter((id) => !stillReferencedIds.has(id));
      if (orphanTeacherIds.length > 0) {
        await tx.matchCandidate.deleteMany({ where: { teacherId: { in: orphanTeacherIds } } });
        await tx.teacher.deleteMany({ where: { id: { in: orphanTeacherIds } } });
      }
    }

    await tx.campagne.delete({ where: { id: campagneId } });
  });

  res.status(204).end();
});

/**
 * The rectorat's promotion quota for each (grade[, vivier]) of a Hors Classe/Classe Exceptionnelle
 * campagne — see Contingent's own doc comment in schema.prisma for contingentAnnonce vs
 * contingentPropose. No per-row CRUD: an admin edits the whole campagne's contingents at once
 * (there's only ever a handful per campagne), so PUT replaces them wholesale — same pattern as
 * settings.ts's social-links.
 */
campagnesRouter.get("/:id/contingents", async (req, res) => {
  const contingents = await prisma.contingent.findMany({ where: { campagneId: req.params.id }, orderBy: [{ grade: "asc" }, { vivier: "asc" }] });
  res.json(contingents);
});

const contingentsSchema = z.object({
  contingents: z
    .array(
      z.object({
        grade: z.string().min(1),
        vivier: z.string().min(1).nullable(),
        contingentAnnonce: z.number().int().min(0).nullable(),
        contingentPropose: z.number().int().min(0).nullable(),
      }),
    )
    .max(50),
});

campagnesRouter.put("/:id/contingents", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const campagneId = req.params.id;
  const existing = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!existing) return res.status(404).json({ error: "Campagne introuvable" });

  const parsed = contingentsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }

  await prisma.$transaction([
    prisma.contingent.deleteMany({ where: { campagneId } }),
    prisma.contingent.createMany({
      data: parsed.data.contingents.map((c) => ({
        campagneId,
        grade: c.grade,
        vivier: c.vivier,
        contingentAnnonce: c.contingentAnnonce,
        contingentPropose: c.contingentPropose,
        updatedById: req.auth!.userId,
      })),
    }),
  ]);

  const contingents = await prisma.contingent.findMany({ where: { campagneId }, orderBy: [{ grade: "asc" }, { vivier: "asc" }] });
  res.json(contingents);
});
