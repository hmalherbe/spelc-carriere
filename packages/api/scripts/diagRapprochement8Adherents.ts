/**
 * Diagnostic ponctuel : pourquoi ces 8 adhérents (export "Adhérents éligibles non présents",
 * 2024-2025 CCMA, 2026-10-17) ne se rapprochent-ils toujours pas de leur enseignant après le
 * correctif de la règle destructive cross-année (voir adherentImport.ts) et un "Recalculer les
 * rapprochements" ? Montre, pour chacun : son MatchCandidate actuel (statut/teacherId), et pour
 * chaque enseignant du pool CCMA 2024-2025 dont le nom est proche, le score de similarité et si le
 * filtre dur de grade (seul vrai blocage automatique, voir matching.ts) les exclut.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagRapprochement8Adherents.ts <campagneId-2024-2025-CCMA>
 */
import { PrismaClient } from "@prisma/client";
import { nameSimilarity, normalizeGrade } from "@spelc/import";

const prisma = new PrismaClient();

const NOMS = [
  ["BITAR", "Mariane"],
  ["CHARRON TRABI", "Marie-Chantal"],
  ["CURNIER", "Eliane"],
  ["DECROO", "Anne-Sophie"],
  ["FERNANDEZ", "Rebecca"],
  ["MORIN", "Elise"],
  ["O'CALLAGHAN", "Florence-Anne"],
  ["PONZANELLI - ARAMINI", "Marie-Claude"],
];

async function main() {
  const campagneId = process.argv[2];
  if (!campagneId) {
    console.error("Usage: npx tsx scripts/diagRapprochement8Adherents.ts <campagneId>");
    process.exitCode = 1;
    return;
  }
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) {
    console.error(`Campagne introuvable : ${campagneId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Campagne : ${campagne.anneeScolaire} ${campagne.commission ?? "?"} (${campagne.nature ?? "?"})\n`);

  const pool = await prisma.teacherSnapshot.findMany({
    where: { campagneId },
    select: { teacherId: true, nomUsage: true, prenom: true, grade: true },
  });
  console.log(`Pool d'enseignants pour cette campagne : ${pool.length}\n`);

  for (const [nom, prenom] of NOMS) {
    const adherent = await prisma.adherent.findFirst({
      where: { nom, prenom },
      include: {
        matchCandidate: {
          include: {
            teacher: {
              select: { snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" }, select: { grade: true, nomUsage: true, prenom: true } } },
            },
          },
        },
      },
    });
    console.log(`=== ${nom} ${prenom} ===`);
    if (!adherent) {
      console.log("  Adhérent introuvable (nom/prénom ne correspondent plus exactement ?)\n");
      continue;
    }
    console.log(`  Adhérent : grade="${adherent.grade}", nomNaissance="${adherent.nomNaissance ?? ""}"`);
    const mc = adherent.matchCandidate;
    console.log(`  MatchCandidate : ${mc ? `status=${mc.status}, teacherId=${mc.teacherId ?? "null"}, confidence=${mc.confidence}` : "aucun"}`);
    if (mc?.teacher?.snapshots[0]) {
      const s = mc.teacher.snapshots[0];
      console.log(`  -> pointe vers : ${s.nomUsage} ${s.prenom} (grade ${s.grade})`);
    }

    // Best candidates in THIS campagne's pool by name similarity, regardless of the grade hard filter.
    const scored = pool
      .map((t) => {
        const nomScore = Math.max(nameSimilarity(adherent.nom, t.nomUsage), adherent.nomNaissance ? nameSimilarity(adherent.nomNaissance, t.nomUsage) : 0);
        const prenomScore = nameSimilarity(adherent.prenom, t.prenom);
        const combined = nomScore * 0.6 + prenomScore * 0.4;
        const gradeMatch = adherent.grade ? normalizeGrade(adherent.grade) === normalizeGrade(t.grade) : null;
        return { t, nomScore, prenomScore, combined, gradeMatch };
      })
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 3);
    for (const s of scored) {
      console.log(
        `  Candidat pool : ${s.t.nomUsage} ${s.t.prenom} (grade ${s.t.grade}) — nom=${s.nomScore.toFixed(2)} prenom=${s.prenomScore.toFixed(2)} combiné=${s.combined.toFixed(2)} gradeMatch=${s.gradeMatch}`,
      );
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
