/**
 * Correctif ponctuel (2026-10-18) : rejette 3 suggestions jamais validées qui bloquaient le bon
 * rapprochement de CURNIER Eliane, MORIN Elise et PONZANELLI-ARAMINI Marie-Claude — voir
 * diagEnseignantsDejaReclames.ts, qui a identifié ces adhérents comme ayant "volé" leur enseignant
 * (matchAdherents() n'assigne jamais le même enseignant à deux adhérents, et un enseignant déjà
 * réclamé reste indisponible tant que la suggestion qui le réclame n'est pas explicitement
 * rejetée). Ne touche à rien d'autre : action strictement identique au bouton "Rejeter" de la file
 * de révision (status -> REJECTED, teacherId laissé tel quel — c'est "Recalculer les
 * rapprochements" ensuite, pas ce script, qui le remet à jour).
 *
 * Usage : npx tsx scripts/rejectBlockingMatches20261018.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADHERENT_IDS_A_REJETER = [
  "cmvb0lhtf008kctd62qlrmyuu", // FOURNIER Blanche — réclamait l'enseignant de CURNIER Eliane
  "cmvb0ljr700esctd68veak67l", // MORINI Nathalie — réclamait l'enseignant de MORIN Elise
  "cmvb0llls00ljctd6e75n6lx9", // ZANARELLI Marie-Amelie — réclamait l'enseignant de PONZANELLI-ARAMINI Marie-Claude
];

async function main() {
  for (const adherentId of ADHERENT_IDS_A_REJETER) {
    const candidate = await prisma.matchCandidate.findUnique({
      where: { adherentId },
      include: { adherent: { select: { nom: true, prenom: true } } },
    });
    if (!candidate) {
      console.log(`${adherentId} : aucun MatchCandidate — rien à faire.`);
      continue;
    }
    if (candidate.status === "REJECTED") {
      console.log(`${candidate.adherent.nom} ${candidate.adherent.prenom} : déjà REJECTED, rien à faire.`);
      continue;
    }
    await prisma.matchCandidate.update({
      where: { adherentId },
      data: { status: "REJECTED" },
    });
    console.log(`${candidate.adherent.nom} ${candidate.adherent.prenom} : rejeté (était ${candidate.status}).`);
  }
  console.log("\nTerminé — lancez maintenant \"Recalculer les rapprochements\" depuis la file de révision.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
