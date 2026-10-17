/**
 * Diagnostic ponctuel (2026-10-18) : compare les deux fiches adhérent "BITAR Mariane" (orthographe
 * historique) et "BITTAR Mariane" (double T, orthographe de l'export ADEL actuel) avant de décider
 * quoi faire du doublon — voir diagEnseignantsDejaReclames.ts, qui a confirmé que "BITTAR" porte
 * déjà le bon lien vers l'enseignant et que "BITAR" en est donc privée.
 *
 * Usage : npx tsx scripts/diagDoublonBitar.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.adherent.findMany({
    where: { OR: [{ nom: "BITAR" }, { nom: "BITTAR" }] },
    include: { matchCandidate: { include: { teacher: { select: { snapshots: { take: 1, select: { nomUsage: true, prenom: true, grade: true } } } } } } },
  });

  for (const a of rows) {
    console.log(`=== ${a.nom} ${a.prenom} (id=${a.id}) ===`);
    console.log(`  civilite=${a.civilite}, nomNaissance=${a.nomNaissance}, grade=${a.grade}, ancienEchelon=${a.ancienEchelon}`);
    console.log(`  statut=${a.statut}, typeContrat=${a.typeContrat}, dateEffet=${a.dateEffet?.toISOString().slice(0, 10)}`);
    console.log(`  mailPersonnel=${a.mailPersonnel}, departement=${a.departement}, reliquatAnciennete=${a.reliquatAnciennete}`);
    console.log(`  matchCandidate : ${a.matchCandidate ? `status=${a.matchCandidate.status}, teacherId=${a.matchCandidate.teacherId}` : "aucun"}`);
    const mailings = await prisma.mailingLog.count({ where: { adherentId: a.id } });
    console.log(`  historique mailing : ${mailings} envoi(s)`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
