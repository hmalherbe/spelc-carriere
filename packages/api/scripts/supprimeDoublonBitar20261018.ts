/**
 * Correctif ponctuel (2026-10-18) : supprime la fiche adhérent "BITAR Mariane" (orthographe
 * historique, obsolète), doublon de "BITTAR Mariane" (orthographe ADEL actuelle, déjà correctement
 * rapprochée) — voir diagDoublonBitar.ts, qui a confirmé la même personne (même email
 * mbittar@outlook.fr) et aucune donnée propre à "BITAR" à préserver (données plus anciennes sur
 * tous les champs, aucun historique de mailing sur l'une ou l'autre fiche).
 *
 * Usage : npx tsx scripts/supprimeDoublonBitar20261018.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADHERENT_ID_A_SUPPRIMER = "cmvcd2njo031etxyck3p0mrc5"; // BITAR Mariane (doublon obsolète de BITTAR)

async function main() {
  const adherent = await prisma.adherent.findUnique({
    where: { id: ADHERENT_ID_A_SUPPRIMER },
    include: { matchCandidate: true },
  });
  if (!adherent) {
    console.log("Déjà supprimé ou introuvable — rien à faire.");
    return;
  }
  if (adherent.nom !== "BITAR" || adherent.prenom !== "Mariane") {
    console.error(`Garde-fou : attendu "BITAR Mariane", trouvé "${adherent.nom} ${adherent.prenom}" — annulé par sécurité.`);
    process.exitCode = 1;
    return;
  }

  if (adherent.matchCandidate) {
    await prisma.matchCandidate.delete({ where: { adherentId: ADHERENT_ID_A_SUPPRIMER } });
  }
  await prisma.adherent.delete({ where: { id: ADHERENT_ID_A_SUPPRIMER } });
  console.log(`Supprimé : ${adherent.nom} ${adherent.prenom} (id=${ADHERENT_ID_A_SUPPRIMER}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
