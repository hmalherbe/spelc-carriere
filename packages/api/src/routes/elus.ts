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
  const elus = await prisma.elu.findMany({
    where: commission ? { commission } : undefined,
    orderBy: [{ commission: "asc" }, { role: "asc" }, { nom: "asc" }],
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
  const elu = await prisma.elu.create({
    data: { commission, role, prenom, nom, telephone: telephone || null, email: email || null },
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
