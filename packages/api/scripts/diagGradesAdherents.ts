/**
 * Diagnostic ponctuel : liste les grades réellement présents parmi les adhérents (tels qu'importés
 * depuis ADEL), avec leur effectif, et signale ceux qui ne correspondent à aucune entrée de
 * GRADE_MAPPINGS (@spelc/domain) — cause la plus probable d'un adhérent invisible dans les listings
 * "éligibles à la CCMA/CCMI" malgré une date de dernier changement d'échelon correcte.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagGradesAdherents.ts
 */
import { PrismaClient } from "@prisma/client";
import { GRADE_MAPPINGS } from "@spelc/domain";

const prisma = new PrismaClient();

async function main() {
  const grouped = await prisma.adherent.groupBy({ by: ["grade"], _count: { _all: true } });
  grouped.sort((a, b) => b._count._all - a._count._all);

  console.log("Grade (adhérents)                                   | Effectif | Mappé ?");
  console.log("-".repeat(80));
  for (const g of grouped) {
    const label = g.grade ?? "(vide)";
    const mapping = g.grade ? GRADE_MAPPINGS.find((m) => m.grade.toUpperCase() === g.grade!.trim().toUpperCase()) : undefined;
    const mappedLabel = mapping ? `OK -> degré ${mapping.degre}` : "NON MAPPÉ";
    console.log(`${label.padEnd(52)} | ${String(g._count._all).padStart(8)} | ${mappedLabel}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
