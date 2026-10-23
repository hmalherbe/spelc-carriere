import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";

export const elusRouter = Router();
elusRouter.use(requireAuth);

/**
 * The union's CCMA/CCMI élus and suppléants — entered once here (Paramètres → onglet "Élus
 * CCMA/CCMI") rather than typed by hand into every mailing, since mailing/template.ts pulls this
 * list automatically for the footer of every promotion-notification e-mail (filtered to the
 * recipient's own commission — see routes/mailing.ts).
 */
elusRouter.get("/", asyncHandler(async (req, res) => {
  const commissionParam = typeof req.query.commission === "string" ? req.query.commission : undefined;
  if (commissionParam && commissionParam !== "CCMA" && commissionParam !== "CCMI") {
    return res.status(400).json({ error: "commission doit être CCMA ou CCMI" });
  }
  const commission = commissionParam as "CCMA" | "CCMI" | undefined;
  // `nom` en second critère : départage seulement les ex-aequo (tous les élus existants avant
  // l'ajout de `ordre` valent 0) — purement un filet de sécurité pour un tri stable tant que
  // personne n'a encore cliqué les flèches haut/bas sur ce groupe.
  const elus = await prisma.elu.findMany({
    where: commission ? { commission } : undefined,
    orderBy: [{ commission: "asc" }, { role: "asc" }, { ordre: "asc" }, { nom: "asc" }],
  });
  res.json(elus);
}));

const eluSchema = z.object({
  commission: z.enum(["CCMA", "CCMI"]),
  role: z.enum(["TITULAIRE", "SUPPLEANT"]),
  prenom: z.string().min(1),
  nom: z.string().min(1),
  telephone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

elusRouter.post("/", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = eluSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { commission, role, prenom, nom, telephone, email } = parsed.data;
  // Nouveau venu en fin de SON groupe (commission, role) — jamais mélangé avec l'autre rôle.
  const last = await prisma.elu.findFirst({ where: { commission, role }, orderBy: { ordre: "desc" } });
  const elu = await prisma.elu.create({
    data: { commission, role, prenom, nom, telephone: telephone || null, email: email || null, ordre: (last?.ordre ?? -1) + 1 },
  });
  res.status(201).json(elu);
}));

elusRouter.patch("/:id", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = eluSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const existing = await prisma.elu.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Élu introuvable" });

  const { telephone, email, ...rest } = parsed.data;
  const elu = await prisma.elu.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(telephone !== undefined ? { telephone: telephone || null } : {}),
      ...(email !== undefined ? { email: email || null } : {}),
    },
  });
  res.json(elu);
}));

elusRouter.delete("/:id", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const existing = await prisma.elu.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Élu introuvable" });
  await prisma.elu.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Échange la position d'un élu avec son voisin immédiat (flèches haut/bas, page Élus) — UNIQUEMENT
 * au sein de son propre groupe (commission, role) : un titulaire ne se mélange jamais avec les
 * suppléants. Renumérote tout le groupe (0..n-1) à chaque appel plutôt que d'échanger seulement
 * deux valeurs `ordre` — auto-cicatrisant si plusieurs élus du groupe partagent encore la même
 * valeur par défaut (0), ce qui est le cas de tout élu créé avant l'ajout de ce champ.
 */
elusRouter.post("/:id/move", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const elu = await prisma.elu.findUnique({ where: { id: req.params.id } });
  if (!elu) return res.status(404).json({ error: "Élu introuvable" });

  const siblings = await prisma.elu.findMany({
    where: { commission: elu.commission, role: elu.role },
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
  });
  const index = siblings.findIndex((s) => s.id === elu.id);
  const swapIndex = parsed.data.direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) {
    return res.status(400).json({ error: swapIndex < 0 ? "Déjà en première position" : "Déjà en dernière position" });
  }
  [siblings[index], siblings[swapIndex]] = [siblings[swapIndex], siblings[index]];
  await prisma.$transaction(siblings.map((s, i) => prisma.elu.update({ where: { id: s.id }, data: { ordre: i } })));
  res.json({ ok: true });
}));
