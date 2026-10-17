/**
 * Suite de diagRapprochement8Adherents.ts : BITAR, CURNIER, MORIN, PONZANELLI ont un candidat
 * quasi-parfait dans le pool (score ~1.00, grade compatible) mais ressortent "Aucune correspondance
 * trouvée" après un recalcul correctement scopé. Hypothèse à vérifier : leur enseignant-candidat est
 * déjà réclamé par un AUTRE MatchCandidate (l'algorithme n'assigne jamais le même enseignant à deux
 * adhérents, voir matchAdherents()) — légitimement ou à cause du même bug qui a mis ces 4 à REJECTED.
 *
 * Usage : npx tsx scripts/diagEnseignantsDejaReclames.ts <campagneId>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CIBLES: { nom: string; prenom: string; teacherNom: string; teacherPrenom: string }[] = [
  { nom: "BITAR", prenom: "Mariane", teacherNom: "BITTAR", teacherPrenom: "MARIANE" },
  { nom: "CURNIER", prenom: "Eliane", teacherNom: "CURNIER", teacherPrenom: "ELIANE" },
  { nom: "MORIN", prenom: "Elise", teacherNom: "MORIN", teacherPrenom: "ELISE" },
  { nom: "PONZANELLI - ARAMINI", prenom: "Marie-Claude", teacherNom: "PONZANELLI", teacherPrenom: "MARIE-CLAUDE" },
];

async function main() {
  const campagneId = process.argv[2];
  if (!campagneId) {
    console.error("Usage: npx tsx scripts/diagEnseignantsDejaReclames.ts <campagneId>");
    process.exitCode = 1;
    return;
  }

  for (const c of CIBLES) {
    console.log(`=== ${c.nom} ${c.prenom} ===`);
    const snapshot = await prisma.teacherSnapshot.findFirst({
      where: { campagneId, nomUsage: c.teacherNom, prenom: c.teacherPrenom },
      select: { teacherId: true, nomUsage: true, prenom: true, grade: true },
    });
    if (!snapshot) {
      console.log(`  Enseignant ${c.teacherNom} ${c.teacherPrenom} introuvable dans cette campagne (nom exact différent ?)\n`);
      continue;
    }
    console.log(`  Enseignant candidat : teacherId=${snapshot.teacherId} (${snapshot.nomUsage} ${snapshot.prenom}, ${snapshot.grade})`);

    const claims = await prisma.matchCandidate.findMany({
      where: { teacherId: snapshot.teacherId },
      include: { adherent: { select: { nom: true, prenom: true, grade: true } } },
    });
    if (claims.length === 0) {
      console.log("  Aucun MatchCandidate ne réclame cet enseignant — ne devrait PAS être bloqué.\n");
    } else {
      for (const claim of claims) {
        console.log(
          `  Réclamé par : ${claim.adherent.nom} ${claim.adherent.prenom} (grade ${claim.adherent.grade}) — adherentId=${claim.adherentId}, status=${claim.status}, confidence=${claim.confidence}`,
        );
      }
      console.log("");
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
