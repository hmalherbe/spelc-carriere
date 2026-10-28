import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * Sauvegarde/rechargement des reclassements calculés dans le simulateur (ReclassementSimulateur.
 * tsx) — voir ReclassementSauvegarde (schema.prisma) pour pourquoi `parametres`/`resultat` sont
 * conservés tels quels plutôt que recalculés au rechargement.
 */
export const reclassementsRouter = Router();
reclassementsRouter.use(requireAuth);

const casEnum = z.enum(["CAS1", "CAS2", "CAS3"]);

const saveSchema = z.object({
  cas: casEnum,
  nom: z.string().min(1),
  prenom: z.string().min(1),
  parametres: z.unknown(),
  resultat: z.unknown(),
});

reclassementsRouter.post(
  "/",
  requireRole("ADMIN", "GESTIONNAIRE"),
  asyncHandler(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { cas, nom, prenom, parametres, resultat } = parsed.data;
    const saved = await prisma.reclassementSauvegarde.create({
      data: {
        cas,
        nom,
        prenom,
        parametres: parametres as object,
        resultat: resultat as object,
        savedById: req.auth!.userId,
      },
    });
    res.status(201).json(saved);
  }),
);

/** Recherche par nom/prénom (chacun optionnel, correspondance partielle insensible à la casse) —
 * renvoie les plus récents en premier, sans le détail (parametres/resultat), pour une liste de
 * résultats à choisir avant de recharger le bon via GET /:id. */
reclassementsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const nom = typeof req.query.nom === "string" ? req.query.nom.trim() : "";
    const prenom = typeof req.query.prenom === "string" ? req.query.prenom.trim() : "";
    if (!nom && !prenom) return res.json([]);
    const results = await prisma.reclassementSauvegarde.findMany({
      where: {
        ...(nom ? { nom: { contains: nom, mode: "insensitive" } } : {}),
        ...(prenom ? { prenom: { contains: prenom, mode: "insensitive" } } : {}),
      },
      orderBy: { savedAt: "desc" },
      select: { id: true, cas: true, nom: true, prenom: true, savedAt: true },
      take: 50,
    });
    res.json(results);
  }),
);

reclassementsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const saved = await prisma.reclassementSauvegarde.findUnique({ where: { id: req.params.id } });
    if (!saved) return res.status(404).json({ error: "Reclassement introuvable" });
    res.json(saved);
  }),
);
