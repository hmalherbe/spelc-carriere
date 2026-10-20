/**
 * Diagnostic ponctuel (2026-10-20) : l'import du fichier adhérents second degré pour CCMA
 * 2026-2027 a renvoyé "0 créés, 785 mis à jour" et AUCUN supprimé, alors que TCHA-KONDOR et MEAZZA
 * (confirmés absents du fichier par recherche manuelle) auraient dû être supprimés par le correctif
 * du 2026-10-20 (prune borné à la commission). Ce résultat (deleted=0 sur l'ensemble de l'import,
 * pas seulement ces deux cas) suggère que `campagne.commission` n'était peut-être pas "CCMA" pour
 * la campagne réellement sélectionnée au moment de l'upload — ce qui désactive silencieusement le
 * prune (repli sur prune:false, voir routes/imports.ts). Liste TOUTES les campagnes existantes avec
 * leurs champs complets pour vérifier ça. Purement en lecture, ne modifie rien.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagToutesCampagnes20261020.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const campagnes = await prisma.campagne.findMany({ orderBy: [{ anneeScolaire: "desc" }, { createdAt: "asc" }] });
  console.log(`${campagnes.length} campagne(s) au total.\n`);
  for (const c of campagnes) {
    console.log(
      `id=${c.id} anneeScolaire=${c.anneeScolaire} type=${c.type} commission=${c.commission} nature=${c.nature} ` +
        `periodeDebut=${c.periodeDebut.toISOString().slice(0, 10)} periodeFin=${c.periodeFin.toISOString().slice(0, 10)} ` +
        `createdAt=${c.createdAt.toISOString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
