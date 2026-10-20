/**
 * Diagnostic ponctuel (2026-10-20) : MEAZZA Sophie et TCHA-KONDOR Ouro restent dans la File de
 * révision après un import/sync ADEL qui ne les contient plus — alors que le correctif du
 * 2026-10-20 (adherentImport.ts) est censé les supprimer, puisqu'ils n'apparaissent plus dans le
 * fichier. Affiche leur fiche adhérent brute (en particulier le champ `grade`, exactement tel que
 * stocké — espaces, accents, casse), ce que `degreForGrade` en déduit (null = grade non reconnu
 * par GRADE_MAPPINGS, donc jamais supprimé par aucun import, par sécurité), leur MatchCandidate, et
 * le dernier sync ADEL enregistré pour chaque commission. Purement en lecture, ne modifie rien.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagNonSupprimesMeazzaTchaKondor20261020.ts
 */
import { PrismaClient } from "@prisma/client";
import { GRADE_MAPPINGS } from "@spelc/domain";

const prisma = new PrismaClient();

const NOMS = ["MEAZZA", "TCHA-KONDOR"];

function degreForGrade(grade: string | null): 1 | 2 | null {
  if (!grade) return null;
  const mapping = GRADE_MAPPINGS.find((g) => g.grade.toUpperCase() === grade.trim().toUpperCase());
  return mapping?.degre ?? null;
}

async function main() {
  for (const nom of NOMS) {
    console.log(`=== Adhérent(s) "${nom}" ===`);
    const adherents = await prisma.adherent.findMany({ where: { nom: { contains: nom, mode: "insensitive" } } });
    if (adherents.length === 0) console.log("  Aucun adhérent trouvé (déjà supprimé ?).\n");
    for (const a of adherents) {
      console.log(`  id=${a.id}`);
      console.log(`  nom="${a.nom}" prenom="${a.prenom}"`);
      console.log(`  grade (brut, exact) = ${JSON.stringify(a.grade)}`);
      console.log(`  degreForGrade(grade) = ${degreForGrade(a.grade)} (null => jamais supprimé par aucun import, par sécurité)`);
      console.log(`  ancienEchelon=${a.ancienEchelon} dateEffet=${a.dateEffet ? a.dateEffet.toISOString().slice(0, 10) : "null"}`);
      console.log(`  importedAt=${a.importedAt.toISOString()}`);

      const candidate = await prisma.matchCandidate.findUnique({ where: { adherentId: a.id } });
      console.log(`  MatchCandidate : ${candidate ? `status=${candidate.status} teacherId=${candidate.teacherId ?? "null"} createdAt=${candidate.createdAt.toISOString()}` : "aucun"}`);
      console.log("");
    }
  }

  console.log("=== Derniers syncs ADEL enregistrés (par commission) ===");
  for (const type of ["CCMA", "CCMI"] as const) {
    const last = await prisma.adelSyncLog.findFirst({ where: { type }, orderBy: { syncedAt: "desc" } });
    console.log(
      last
        ? `  ${type} : ${last.syncedAt.toISOString()} status=${last.status} created=${last.created} updated=${last.updated}${last.error ? ` error=${last.error}` : ""}`
        : `  ${type} : aucun sync enregistré`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
