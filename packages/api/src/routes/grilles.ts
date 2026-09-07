import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";

export const grillesRouter = Router();
grillesRouter.use(requireAuth);

/**
 * Everything the "Grilles indiciaires" screen needs in one call: every grille + its rows, the
 * grade -> grille mappings (to build the grade/échelle filters), and the current valeur du point.
 * The dataset is small (a dozen grilles, ~150 rows total) — no pagination, filtering happens
 * client-side.
 */
grillesRouter.get("/", asyncHandler(async (_req, res) => {
  const [grilles, gradeMappings, valeurDuPoint] = await Promise.all([
    prisma.grille.findMany({ include: { rows: true } }),
    prisma.gradeMapping.findMany(),
    prisma.valeurDuPoint.findFirst({ orderBy: { applicableA: "desc" } }),
  ]);
  res.json({ grilles, gradeMappings, valeurDuPoint });
}));

const updateIndiceSchema = z.object({ indice: z.number().int().positive() });

grillesRouter.patch(
  "/:code/rows/:echelon",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = updateIndiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { code, echelon } = req.params;
    try {
      const row = await prisma.echelonRow.update({
        where: { grilleCode_echelon: { grilleCode: code, echelon } },
        data: { indice: parsed.data.indice },
      });
      res.json(row);
    } catch {
      res.status(404).json({ error: `Ligne introuvable pour la grille ${code}, échelon ${echelon}` });
    }
  }),
);

const newValeurDuPointSchema = z.object({
  valeur: z.number().positive(),
  applicableA: z.string().datetime().or(z.string().date()),
});

grillesRouter.post(
  "/valeur-du-point",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = newValeurDuPointSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    // A new row, not an update — history is kept on purpose (see schema.prisma) so past
    // calculations stay reproducible even after a revalorisation.
    const created = await prisma.valeurDuPoint.create({
      data: { valeur: parsed.data.valeur, applicableA: new Date(parsed.data.applicableA) },
    });
    res.status(201).json(created);
  }),
);
