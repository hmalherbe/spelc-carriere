import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * Sauvegarde/rechargement des reclassements calculés dans le simulateur (ReclassementSimulateur.
 * tsx) — voir ReclassementSauvegarde (schema.prisma) pour pourquoi `parametres`/`resultat` sont
 * conservés tels quels plutôt que recalculés au rechargement.
 *
 * Au plus UN reclassement enregistré par (cas, nom, prénom) — une recherche par nom/prénom pour un
 * type de reclassement donné ne doit jamais avoir plusieurs résultats possibles. Enregistrer à
 * nouveau pour le même (cas, nom, prénom) remplace donc le précédent plutôt que d'en empiler un
 * nouveau (upsert ci-dessous), et la recherche renvoie directement ce résultat unique (ou aucun),
 * jamais une liste à choisir dedans.
 */
export const reclassementsRouter = Router();
reclassementsRouter.use(requireAuth);

const casEnum = z.enum(["CAS1", "CAS2", "CAS3"]);

async function trouverExistant(cas: z.infer<typeof casEnum>, nom: string, prenom: string) {
  return prisma.reclassementSauvegarde.findFirst({
    where: { cas, nom: { equals: nom, mode: "insensitive" }, prenom: { equals: prenom, mode: "insensitive" } },
  });
}

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
    const existant = await trouverExistant(cas, nom, prenom);
    const data = { cas, nom, prenom, parametres: parametres as object, resultat: resultat as object, savedById: req.auth!.userId };
    const saved = existant
      ? await prisma.reclassementSauvegarde.update({ where: { id: existant.id }, data })
      : await prisma.reclassementSauvegarde.create({ data });
    res.status(existant ? 200 : 201).json(saved);
  }),
);

/** Recherche exacte (insensible à la casse) par (cas, nom, prénom) — au plus un résultat possible
 * grâce à l'upsert ci-dessus ; `null` si rien d'enregistré pour cet enseignant sur ce type de
 * reclassement. */
reclassementsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const cas = casEnum.safeParse(req.query.cas);
    const nom = typeof req.query.nom === "string" ? req.query.nom.trim() : "";
    const prenom = typeof req.query.prenom === "string" ? req.query.prenom.trim() : "";
    if (!cas.success || !nom || !prenom) {
      return res.status(400).json({ error: "cas, nom et prénom sont requis" });
    }
    const saved = await trouverExistant(cas.data, nom, prenom);
    res.json(saved ?? null);
  }),
);
