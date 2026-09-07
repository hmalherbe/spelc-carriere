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
});

campagnesRouter.post("/", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = createCampagneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { anneeScolaire, periodeDebut, periodeFin, dateCcma } = parsed.data;
  const campagne = await prisma.campagne.create({
    data: {
      anneeScolaire,
      periodeDebut: new Date(periodeDebut),
      periodeFin: new Date(periodeFin),
      dateCcma: new Date(dateCcma),
    },
  });
  res.status(201).json(campagne);
});
