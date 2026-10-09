/**
 * Diagnostic ponctuel pour la page "Adhérents éligibles" : pourquoi un adhérent éligible à une
 * campagne est-il signalé "non présent dans les fichiers du rectorat" ? Réutilise directement
 * computeAdherentEligibility (la même logique que routes/adherents.ts) au lieu de faire deviner du
 * SQL équivalent à un LLM — l'éligibilité dépend du calcul de grille (computeEchelonPromotion), pas
 * d'une simple colonne, ce qui s'est avéré trop fragile à reproduire fiablement via l'Assistant IA.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagnoseAdherents.ts <campagneId>
 *   npx tsx scripts/diagnoseAdherents.ts --list     (pour retrouver un campagneId)
 */
import { PrismaClient } from "@prisma/client";
import { computeAdherentEligibility } from "../src/adherentEligibility.js";

const prisma = new PrismaClient();

async function listCampagnes() {
  const campagnes = await prisma.campagne.findMany({ orderBy: [{ periodeDebut: "desc" }] });
  for (const c of campagnes) {
    console.log(`${c.id}  ${c.type ?? "?"}  ${c.anneeScolaire}  CCMA du ${c.dateCcma.toISOString().slice(0, 10)}`);
  }
}

async function diagnose(campagneId: string) {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) {
    console.error(`Campagne introuvable : ${campagneId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Campagne : ${campagne.type ?? "?"} ${campagne.anneeScolaire} (CCMA du ${campagne.dateCcma.toISOString().slice(0, 10)})\n`);

  const adherents = await prisma.adherent.findMany({
    include: {
      matchCandidate: {
        include: { teacher: { include: { snapshots: { where: { campagneId }, take: 1 } } } },
      },
    },
  });

  type Category = "AUCUN_CANDIDAT" | "PENDING_REVIEW" | "REJECTED" | "CONFIRME_SANS_FICHE" | "CONFIRME_OK";
  const buckets: Record<Category, { nom: string; prenom: string; grade: string | null }[]> = {
    AUCUN_CANDIDAT: [],
    PENDING_REVIEW: [],
    REJECTED: [],
    CONFIRME_SANS_FICHE: [],
    CONFIRME_OK: [],
  };

  let totalEligible = 0;

  for (const a of adherents) {
    const eligibility = computeAdherentEligibility(a, campagne);
    if (!eligibility.eligible) continue;
    totalEligible++;

    const mc = a.matchCandidate;
    const row = { nom: a.nom, prenom: a.prenom, grade: a.grade };

    if (!mc) {
      buckets.AUCUN_CANDIDAT.push(row);
    } else if (mc.status === "REJECTED") {
      buckets.REJECTED.push(row);
    } else if (mc.status === "PENDING_REVIEW") {
      buckets.PENDING_REVIEW.push(row);
    } else {
      // CONFIRMED ou AUTO_CONFIRMED
      const hasSnapshot = (mc.teacher?.snapshots.length ?? 0) > 0;
      if (hasSnapshot) buckets.CONFIRME_OK.push(row);
      else buckets.CONFIRME_SANS_FICHE.push(row);
    }
  }

  const nonPresent = totalEligible - buckets.CONFIRME_OK.length;
  console.log(`Adhérents éligibles à cette campagne : ${totalEligible}`);
  console.log(`Non présents dans les fichiers du rectorat : ${nonPresent}\n`);

  for (const [label, rows] of Object.entries(buckets) as [Category, typeof buckets.AUCUN_CANDIDAT][]) {
    console.log(`--- ${label} (${rows.length}) ---`);
    for (const r of rows.slice(0, 15)) {
      console.log(`  ${r.nom} ${r.prenom}  (grade: ${r.grade ?? "—"})`);
    }
    if (rows.length > 15) console.log(`  ... et ${rows.length - 15} de plus`);
    console.log("");
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    await listCampagnes();
    return;
  }
  await diagnose(arg);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
