/**
 * Diagnostic ponctuel (2026-10-20) : malgré un fichier ADEL second degré fraîchement téléchargé,
 * TCHA-KONDOR et MEAZZA (confirmés absents du fichier) ne sont toujours pas supprimés de la base,
 * et l'import rapporte 0 supprimé sur l'ensemble. Pour savoir si le bug est dans la fonction
 * importAdherentRecords elle-même (même déployée) ou ailleurs (ex. mauvaise campagne/commission
 * transmise par la route HTTP), ce script appelle DIRECTEMENT le vrai module déployé — pas une
 * copie — avec un adhérent jetable fabriqué pour l'occasion, clairement second degré et absent du
 * "fichier" factice d'une seule ligne qu'on lui passe. Si ce test échoue aussi (l'adhérent jetable
 * n'est pas supprimé), le bug est dans la fonction elle-même, ou dans son environnement d'exécution
 * (ex. GRADE_MAPPINGS qui ne se résout pas comme attendu dans ce conteneur). S'il réussit, le
 * problème est ailleurs (commission/campagneId réellement transmis par la requête HTTP).
 *
 * Nettoie systématiquement après lui (le jetable créé ET celui qui aurait dû être supprimé, au cas
 * où le test échouerait et le laisserait traîner).
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagTestPruneReel20261020.ts
 */
import { prisma } from "../src/db.js";
import { importAdherentRecords } from "../src/adherentImport.js";

const MARQUEUR = "DIAGTESTPRUNEREEL20261020";

async function main() {
  // Nettoyage d'un run précédent éventuel
  await prisma.matchCandidate.deleteMany({ where: { adherent: { nom: { contains: MARQUEUR } } } });
  await prisma.adherent.deleteMany({ where: { nom: { contains: MARQUEUR } } });

  // Une vraie campagne CCMA existante — n'importe laquelle avec commission=CCMA fait l'affaire,
  // matchUnresolvedAdherents a juste besoin que la campagne existe.
  const campagne = await prisma.campagne.findFirst({ where: { commission: "CCMA" } });
  if (!campagne) {
    console.log("Aucune campagne commission=CCMA trouvée — impossible de tester.");
    return;
  }
  console.log(`Campagne utilisée pour le test : id=${campagne.id} anneeScolaire=${campagne.anneeScolaire} commission=${campagne.commission}\n`);

  // Adhérent jetable, clairement second degré (CERTIFIE), absent du "fichier" qu'on va importer.
  const stale = await prisma.adherent.create({
    data: { nom: `${MARQUEUR}_OLD`, prenom: "X", grade: "CERTIFIE", ancienEchelon: "6", dateEffet: new Date("2024-01-01") },
  });
  console.log(`Adhérent jetable créé (doit être supprimé par le test) : id=${stale.id}\n`);

  const before = await prisma.adherent.findUnique({ where: { id: stale.id } });
  console.log("Avant l'import : présent =", before != null);

  await importAdherentRecords(
    [
      {
        civilite: null,
        nom: `${MARQUEUR}_NEW`,
        prenom: "Y",
        nomNaissance: null,
        grade: "CERTIFIE",
        ancienEchelon: "4",
        statut: null,
        typeContrat: null,
        ancienIndice: null,
        dateEffet: "2024-01-01",
        mailPersonnel: null,
        departement: null,
        spelc: null,
        reliquat: null,
      },
    ],
    { prune: true, commission: "CCMA" },
    campagne.id,
  );

  const after = await prisma.adherent.findUnique({ where: { id: stale.id } });
  console.log("Après l'import (prune: true, commission: CCMA) : présent =", after != null);
  console.log("");
  console.log(after == null ? "RÉSULTAT : la fonction supprime correctement — le bug est AILLEURS (route HTTP, campagne/commission réellement transmise)." : "RÉSULTAT : la fonction NE supprime PAS même dans ce cas isolé — le bug est DANS la fonction ou son environnement d'exécution.");

  // Nettoyage complet, qu'on ait réussi ou non
  await prisma.matchCandidate.deleteMany({ where: { adherent: { nom: { contains: MARQUEUR } } } });
  await prisma.adherent.deleteMany({ where: { nom: { contains: MARQUEUR } } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
