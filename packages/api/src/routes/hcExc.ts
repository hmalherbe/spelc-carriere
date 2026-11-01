import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { decisionEffective } from "../hcExcComputation.js";

export const hcExcRouter = Router();
hcExcRouter.use(requireAuth);

/**
 * Lists a Hors Classe/Classe Exceptionnelle campagne's snapshots, joined with adhérent-matching
 * status and each one's own "promu" decision — `decisionEffective` (le marqueur "Choix du
 * Recteur" du fichier rectorat, sauf correction manuelle, voir HcExcSnapshot.decisionManuelle's
 * own doc comment), plus jamais une comparaison rang <= contingent saisi à la main.
 */
hcExcRouter.get("/", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const snapshots = await prisma.hcExcSnapshot.findMany({
    where: { campagneId },
    include: { teacher: { include: { matchCandidate: { include: { adherent: true } } } } },
    orderBy: [{ grade: "asc" }, { vivier: "asc" }, { rang: "asc" }],
  });

  const rows = snapshots.map((snap) => {
    const promu = decisionEffective(snap);

    const matchCandidate = snap.teacher.matchCandidate;
    const adherent =
      matchCandidate && (matchCandidate.status === "CONFIRMED" || matchCandidate.status === "AUTO_CONFIRMED") ? matchCandidate.adherent : null;

    return {
      id: snap.id,
      teacherId: snap.teacherId,
      nomUsage: snap.nomUsage,
      prenom: snap.prenom,
      grade: snap.grade,
      vivier: snap.vivier,
      rang: snap.rang,
      totalBareme: snap.totalBareme,
      choixRecteur: snap.choixRecteur,
      decisionManuelle: snap.decisionManuelle,
      promu,
      appreciationRecteur: snap.appreciationRecteur,
      pointsRecteur: snap.pointsRecteur,
      pointsAnciennete: snap.pointsAnciennete,
      isAdherent: adherent != null,
      adherentEmail: adherent?.mailPersonnel ?? null,
    };
  });

  // Résumé par (grade, vivier) — "rang du dernier promu" (le plus grand rang parmi les promus du
  // groupe, les décisions n'étant plus forcément contiguës dès qu'une correction manuelle existe)
  // et le nombre de promus, calculés ici une seule fois par groupe à partir des lignes déjà
  // chargées ci-dessus plutôt qu'une requête par groupe.
  const groupKeys = new Set(rows.map((r) => `${r.grade}|${r.vivier ?? ""}`));
  const groupes = [...groupKeys].map((key) => {
    const [grade, vivierRaw] = key.split("|");
    const vivier = vivierRaw || null;
    const groupRows = rows.filter((r) => r.grade === grade && r.vivier === vivier);
    const promus = groupRows.filter((r) => r.promu);
    const dernierPromu = promus.reduce<(typeof promus)[number] | null>((max, p) => (!max || p.rang > max.rang ? p : max), null);
    return {
      grade,
      vivier,
      nombrePromus: promus.length,
      rangDernierPromu: dernierPromu?.rang ?? null,
      totalBaremeDernierPromu: dernierPromu?.totalBareme ?? null,
    };
  });

  res.json({ rows, groupes });
});

const decisionSchema = z.object({ decisionManuelle: z.boolean().nullable() });

/** Override manuel de la décision de promotion, modifiable depuis l'onglet Mailing Hors Classe /
 * Classe exceptionnelle — null revient au marqueur "Choix du Recteur" du fichier rectorat. */
hcExcRouter.patch("/:id/decision", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });

  const snap = await prisma.hcExcSnapshot.findUnique({ where: { id: req.params.id } });
  if (!snap) return res.status(404).json({ error: "Fiche introuvable" });

  const updated = await prisma.hcExcSnapshot.update({
    where: { id: req.params.id },
    data: { decisionManuelle: parsed.data.decisionManuelle },
  });
  res.json({ id: updated.id, choixRecteur: updated.choixRecteur, decisionManuelle: updated.decisionManuelle, promu: decisionEffective(updated) });
});
