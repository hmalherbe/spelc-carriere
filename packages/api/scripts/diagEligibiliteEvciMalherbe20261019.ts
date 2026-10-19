/**
 * Diagnostic ponctuel (2026-10-19) : EVCI et Hugues MALHERBE restent dans la File de révision pour
 * la campagne CCMA 2026-2027 alors que le calcul manuel de l'union, à partir de leur fiche adhérent
 * (grade + échelon en cours + date de la dernière promotion), les donne non éligibles à cette
 * campagne. Le correctif du 2026-10-19 (routes/matches.ts) se base désormais uniquement sur
 * computeAdherentEligibility(adherent, campagne) — ce script affiche exactement ce que cette
 * fonction calcule pour ces deux cas précis, plus la période réelle de la campagne elle-même
 * (un mauvais paramétrage de campagne.periodeDebut/periodeFin est une cause plausible), pour
 * localiser l'écart avant de corriger quoi que ce soit. Purement en lecture, ne modifie rien.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagEligibiliteEvciMalherbe20261019.ts
 */
import { PrismaClient } from "@prisma/client";
import { computeAdherentEligibility } from "../src/adherentEligibility.js";

const prisma = new PrismaClient();

const NOMS = ["EVCI", "MALHERBE"];

async function main() {
  const campagnes = await prisma.campagne.findMany({
    where: { anneeScolaire: { contains: "2026-2027" }, OR: [{ commission: "CCMA" }, { type: "CCMA" }] },
  });
  console.log(`=== Campagne(s) CCMA 2026-2027 trouvée(s) : ${campagnes.length} ===\n`);
  for (const c of campagnes) {
    console.log(
      `id=${c.id} anneeScolaire=${c.anneeScolaire} commission=${c.commission} type=${c.type} nature=${c.nature} ` +
        `periodeDebut=${c.periodeDebut.toISOString().slice(0, 10)} periodeFin=${c.periodeFin.toISOString().slice(0, 10)}`,
    );
  }
  console.log("");

  for (const nom of NOMS) {
    console.log(`=== Adhérent(s) "${nom}" ===`);
    const adherents = await prisma.adherent.findMany({ where: { nom: { contains: nom, mode: "insensitive" } } });
    if (adherents.length === 0) console.log("  Aucun adhérent trouvé.\n");
    for (const a of adherents) {
      console.log(
        `  id=${a.id} nom=${a.nom} prenom=${a.prenom} grade=${a.grade} ancienEchelon=${a.ancienEchelon} ` +
          `dateEffet=${a.dateEffet ? a.dateEffet.toISOString().slice(0, 10) : "null"} mail=${a.mailPersonnel ?? "—"}`,
      );
      const candidate = await prisma.matchCandidate.findUnique({ where: { adherentId: a.id } });
      console.log(`    MatchCandidate : ${candidate ? `status=${candidate.status} teacherId=${candidate.teacherId ?? "null"}` : "aucun"}`);

      for (const c of campagnes) {
        const result = computeAdherentEligibility(a, c);
        console.log(
          `    Pour campagne ${c.id} (${c.periodeDebut.toISOString().slice(0, 10)} -> ${c.periodeFin.toISOString().slice(0, 10)}) : ` +
            `degre=${result.degre} dateProchainePromotion=${result.dateProchainePromotion ?? "null"} eligible=${result.eligible}`,
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
