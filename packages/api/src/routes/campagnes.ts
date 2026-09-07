import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";

export const campagnesRouter = Router();

campagnesRouter.use(requireAuth);

campagnesRouter.get("/", async (_req, res) => {
  const campagnes = await prisma.campagne.findMany({
    orderBy: { periodeDebut: "desc" },
    include: { _count: { select: { teacherSnapshots: true, imports: true } } },
  });
  res.json(campagnes);
});
