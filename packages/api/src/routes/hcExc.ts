import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";

export const hcExcRouter = Router();
hcExcRouter.use(requireAuth);

/**
 * Lists a Hors Classe/Classe Exceptionnelle campagne's snapshots, joined with adhérent-matching
 * status and each one's own "promu" decision — the rectorat's own rang (never re-derived from
 * totalBareme, see hcExcComputation.ts's own doc comment) compared against that (grade, vivier)
 * group's contingent, computed once per group here rather than N+1 per row.
 */
hcExcRouter.get("/", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const [snapshots, contingents] = await Promise.all([
    prisma.hcExcSnapshot.findMany({
      where: { campagneId },
      include: { teacher: { include: { matchCandidate: { include: { adherent: true } } } } },
      orderBy: [{ grade: "asc" }, { vivier: "asc" }, { rang: "asc" }],
    }),
    prisma.contingent.findMany({ where: { campagneId } }),
  ]);

  const contingentByGroup = new Map(contingents.map((c) => [`${c.grade}|${c.vivier ?? ""}`, c.contingentAnnonce ?? c.contingentPropose ?? 0]));

  // Rang du dernier promu / total barème du dernier promu (the same summary the central
  // spreadsheet's own "Params HC & EXC" sheet shows) — derived per group in the same pass as
  // `promu`, from the same already-sorted-by-rang snapshots, rather than a second query.
  const cutlineByGroup = new Map<string, { rangDernierPromu: number | null; totalBaremeDernierPromu: number | null }>();

  const rows = snapshots.map((snap) => {
    const groupKey = `${snap.grade}|${snap.vivier ?? ""}`;
    const contingent = contingentByGroup.get(groupKey) ?? 0;
    if (!cutlineByGroup.has(groupKey)) {
      const groupSnapshots = snapshots.filter((s) => `${s.grade}|${s.vivier ?? ""}` === groupKey);
      const dernierPromu = groupSnapshots[Math.min(contingent, groupSnapshots.length) - 1];
      cutlineByGroup.set(groupKey, {
        rangDernierPromu: dernierPromu?.rang ?? null,
        totalBaremeDernierPromu: dernierPromu?.totalBareme ?? null,
      });
    }
    const promu = snap.rang <= contingent;

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
      promu,
      contingent,
      appreciationRecteur: snap.appreciationRecteur,
      pointsRecteur: snap.pointsRecteur,
      pointsAnciennete: snap.pointsAnciennete,
      isAdherent: adherent != null,
      adherentEmail: adherent?.mailPersonnel ?? null,
    };
  });

  const allGroupKeys = new Set([...contingentByGroup.keys(), ...snapshots.map((s) => `${s.grade}|${s.vivier ?? ""}`)]);
  const groupes = [...allGroupKeys].map((key) => {
    const [grade, vivierRaw] = key.split("|");
    const vivier = vivierRaw || null;
    const cutline = cutlineByGroup.get(key) ?? { rangDernierPromu: null, totalBaremeDernierPromu: null };
    return { grade, vivier, contingent: contingentByGroup.get(key) ?? 0, ...cutline };
  });

  res.json({ rows, groupes });
});
