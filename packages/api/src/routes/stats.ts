import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { computeBaStatus } from "../baStatus.js";
import { civiliteFromPrenom } from "@spelc/import";

export const statsRouter = Router();
statsRouter.use(requireAuth);

interface GenreCounts {
  hommes: number;
  femmes: number;
  indetermine: number;
}

function emptyGenreCounts(): GenreCounts {
  return { hommes: 0, femmes: 0, indetermine: 0 };
}

/**
 * Same declared-first, estimated-fallback rule as eligibleRecipients() in routes/mailing.ts (kept
 * separate rather than shared: that one needs a display token + an "estimée" flag, this one only
 * needs a sexe to bucket into) — an adhérent's civilité is a declared field, a non-adhérent's is
 * guessed from their prénom (packages/import's civiliteFromPrenom), and either can come back
 * unresolved (unknown/ambiguous prénom) — that always lands in "indéterminé", never a coin flip.
 */
function resolveSexe(declaredCivilite: string | null, prenom: string): "M" | "F" | null {
  const token = declaredCivilite ?? civiliteFromPrenom(prenom);
  if (!token) return null;
  const c = token.trim().toLowerCase();
  if (c.startsWith("mme") || c.startsWith("mlle")) return "F";
  if (c.startsWith("m")) return "M";
  return null;
}

function withPct(counts: GenreCounts, total: number) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    hommes: { n: counts.hommes, pct: pct(counts.hommes) },
    femmes: { n: counts.femmes, pct: pct(counts.femmes) },
    indetermine: { n: counts.indetermine, pct: pct(counts.indetermine) },
  };
}

statsRouter.get("/", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  const grade = typeof req.query.grade === "string" && req.query.grade !== "" ? req.query.grade : undefined;

  const allSnapshots = await prisma.teacherSnapshot.findMany({
    where: { campagneId },
    include: { teacher: { include: { matchCandidate: { include: { adherent: true } } } } },
  });
  // Always the full campagne's grade list, independent of the `grade` filter itself, so the
  // dropdown that drives it doesn't collapse to one option once a grade is selected.
  const grades = Array.from(new Set(allSnapshots.map((s) => s.grade))).sort();
  const snapshots = grade ? allSnapshots.filter((s) => s.grade === grade) : allSnapshots;

  const seenTeacherIds = new Set<string>();
  let baPromus = 0;
  let baNonPromus = 0;
  let baNational = 0;
  let baHorsFenetre = 0;
  const baGenre = emptyGenreCounts(); // among BA promouvables (promus + non promus) only
  let totalPromus = 0;
  const totalPromusGenre = emptyGenreCounts();

  for (const snap of snapshots) {
    const teacher = snap.teacher;
    if (seenTeacherIds.has(teacher.id)) continue; // a duplicate reimport could leave >1 snapshot for the same teacher
    seenTeacherIds.add(teacher.id);

    const { baStatus, arrivedThisEchelon } = computeBaStatus(snap);

    const candidate = teacher.matchCandidate;
    const isAdherent = candidate != null && (candidate.status === "AUTO_CONFIRMED" || candidate.status === "CONFIRMED");
    const declaredCivilite = isAdherent ? candidate!.adherent.civilite : null;
    const prenom = isAdherent ? candidate!.adherent.prenom : snap.prenom;
    const sexe = resolveSexe(declaredCivilite, prenom);

    // "BA" here means the promouvables population per product decision: a promu/non_promu call is
    // only ever made for these two statuses — "national" (agrégé, decided at ministry level) and
    // "hors_fenetre" (anomaly) are surfaced as separate counts for context, not folded into either
    // the promouvables total or the genre breakdown, since neither is a real promu/non-promu call.
    if (baStatus === "promu" || baStatus === "non_promu") {
      if (baStatus === "promu") baPromus++;
      else baNonPromus++;
      if (sexe === "M") baGenre.hommes++;
      else if (sexe === "F") baGenre.femmes++;
      else baGenre.indetermine++;
    } else if (baStatus === "national") {
      baNational++;
    } else if (baStatus === "hors_fenetre") {
      baHorsFenetre++;
    }

    // "tous les promus" is campaign-wide and independent of BA: every teacher who actually arrived
    // at a new échelon this cycle, through any track (AN/CL/RE or a completed BA arrival).
    if (arrivedThisEchelon) {
      totalPromus++;
      if (sexe === "M") totalPromusGenre.hommes++;
      else if (sexe === "F") totalPromusGenre.femmes++;
      else totalPromusGenre.indetermine++;
    }
  }

  const baPromouvables = baPromus + baNonPromus;

  res.json({
    grades,
    ba: {
      promus: baPromus,
      nonPromus: baNonPromus,
      promouvables: baPromouvables,
      pctPromus: baPromouvables > 0 ? Math.round((baPromus / baPromouvables) * 1000) / 10 : 0,
      national: baNational,
      horsFenetre: baHorsFenetre,
      genre: withPct(baGenre, baPromouvables),
    },
    tousLesPromus: {
      total: totalPromus,
      genre: withPct(totalPromusGenre, totalPromus),
    },
  });
});
