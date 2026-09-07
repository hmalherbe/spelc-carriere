import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const baSeuilsRouter = Router();

baSeuilsRouter.use(requireAuth);

baSeuilsRouter.get("/", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  const seuils = await prisma.baSeuil.findMany({
    where: campagneId ? { campagneId } : undefined,
    orderBy: [{ grade: "asc" }, { echelonDepart: "asc" }],
  });
  res.json(seuils);
});

const overrideSchema = z.object({
  minBareme: z.number().int().min(0).max(4).optional(),
  minAncienneteGrade: z.number().min(0).optional(),
  minAncienneteEchelon: z.number().min(0).optional(),
  minAge: z.number().int().optional(),
  locked: z.boolean().optional(),
});

/**
 * Per product decision, the auto-inferred BA threshold is an estimate an ADMIN can correct and
 * lock once the rectorat's actual campaign cutoff is known — this is the only way a BaSeuil row
 * changes after the seed/re-import computed it.
 */
baSeuilsRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const seuil = await prisma.baSeuil.findUnique({ where: { id: req.params.id } });
  if (!seuil) return res.status(404).json({ error: "Seuil introuvable" });

  const updated = await prisma.baSeuil.update({
    where: { id: req.params.id },
    data: { ...parsed.data, lockedById: parsed.data.locked ? req.auth!.userId : seuil.lockedById },
  });
  res.json(updated);
});
