import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const campagnesRouter = Router();

campagnesRouter.use(requireAuth);

campagnesRouter.get("/", async (_req, res) => {
  const campagnes = await prisma.campagne.findMany({
    orderBy: { periodeDebut: "desc" },
    include: { _count: { select: { teacherSnapshots: true, imports: true } } },
  });
  res.json(campagnes);
});

const createCampagneSchema = z.object({
  anneeScolaire: z.string().min(1),
  periodeDebut: z.string().datetime().or(z.string().date()),
  periodeFin: z.string().datetime().or(z.string().date()),
  dateCcma: z.string().datetime().or(z.string().date()),
  // CCMA/CCMI — required for every new campagne, since it decides which élus (see Elu) are
  // inserted in every mailing sent for it (routes/mailing.ts). Existing campagnes created before
  // this field existed keep it null until set via PATCH below.
  type: z.enum(["CCMA", "CCMI"]),
});

campagnesRouter.post("/", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = createCampagneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { anneeScolaire, periodeDebut, periodeFin, dateCcma, type } = parsed.data;
  const campagne = await prisma.campagne.create({
    data: {
      anneeScolaire,
      periodeDebut: new Date(periodeDebut),
      periodeFin: new Date(periodeFin),
      dateCcma: new Date(dateCcma),
      type,
    },
  });
  res.status(201).json(campagne);
});

const updateCampagneTypeSchema = z.object({ type: z.enum(["CCMA", "CCMI"]) });

/** The only field editable after creation — lets an admin retroactively set the commission on a
 * campagne created before this field existed. */
campagnesRouter.patch("/:id", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = updateCampagneTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const existing = await prisma.campagne.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Campagne introuvable" });

  const campagne = await prisma.campagne.update({ where: { id: req.params.id }, data: { type: parsed.data.type } });
  res.json(campagne);
});
