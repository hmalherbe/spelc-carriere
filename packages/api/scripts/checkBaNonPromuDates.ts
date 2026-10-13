/**
 * Diagnostic ponctuel : liste, pour une campagne donnée, tous les candidats à la bonification
 * d'ancienneté (BA) NON retenus cette année (baStatus "non_promu") avec la date du rectorat, la
 * date stockée (dateProchainePromotion) et si elle correspond bien à "date du rectorat + 1 an" — la
 * règle confirmée par l'union (voir promotionState.ts's own doc comment, cas réel Jan-César NATAF).
 * Signale toute incohérence au lieu de la supposer corrigée partout.
 *
 * Inclut encore l'ancien statut "hors_fenetre" dans la recherche (voir baStatus.ts's own doc
 * comment, 2026-10-13 : ce statut a été supprimé, fusionné dans "non_promu") — la colonne stockée
 * ComputedPromotionState.baStatus ne perd cette ancienne valeur qu'après un recompute (voir
 * recomputeAllPromotionStates.ts) ; tant que ce n'est pas fait sur une campagne donnée, ce script
 * la retrouve quand même ici.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/checkBaNonPromuDates.ts <campagneId>
 *   npx tsx scripts/checkBaNonPromuDates.ts --list     (pour retrouver un campagneId)
 */
import { PrismaClient } from "@prisma/client";
import { addCalendarYMD } from "@spelc/domain";

const prisma = new PrismaClient();

async function listCampagnes() {
  const campagnes = await prisma.campagne.findMany({ orderBy: [{ periodeDebut: "desc" }] });
  for (const c of campagnes) {
    console.log(`${c.id}  ${c.type ?? "?"}  ${c.anneeScolaire}  CCMA du ${c.dateCcma.toISOString().slice(0, 10)}`);
  }
}

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function check(campagneId: string) {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) {
    console.error(`Campagne introuvable : ${campagneId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Campagne : ${campagne.type ?? "?"} ${campagne.anneeScolaire} (CCMA du ${campagne.dateCcma.toISOString().slice(0, 10)})\n`);

  const snapshots = await prisma.teacherSnapshot.findMany({
    where: { campagneId, teacher: { computedStates: { some: { campagneId, baStatus: { in: ["non_promu", "hors_fenetre"] } } } } },
    include: { teacher: { include: { computedStates: { where: { campagneId }, take: 1 } } } },
    orderBy: [{ nomUsage: "asc" }],
  });

  console.log(`${snapshots.length} candidat(s) BA non retenu(s) (non_promu / hors_fenetre) trouvé(s).\n`);

  let anomalies = 0;
  for (const snap of snapshots) {
    const state = snap.teacher.computedStates[0];
    const rectoratDate = snap.dateProchainePromotionRectorat;
    const stored = state?.dateProchainePromotion ?? null;

    let attendu: Date | null = null;
    if (rectoratDate) {
      attendu = new Date(addCalendarYMD(rectoratDate.toISOString().slice(0, 10), { annees: 1, mois: 0, jours: 0 }));
    }

    const ok = rectoratDate ? attendu && stored && attendu.getTime() === stored.getTime() : stored === null;

    if (!ok) {
      anomalies++;
      console.log(
        `  [ANOMALIE] ${snap.nomUsage} ${snap.prenom} (${snap.grade}, éch. ${snap.echelonActuel}, ${state?.baStatus ?? "?"}) : ` +
          `rectorat=${fmt(rectoratDate)}  stocké=${fmt(stored)}  attendu=${fmt(attendu)}`,
      );
    }
  }

  if (anomalies === 0) {
    console.log("Aucune anomalie : chaque candidat BA non retenu affiche bien 'date du rectorat + 1 an' (ou rien si le rectorat n'en donnait pas).");
  } else {
    console.log(`\n${anomalies} anomalie(s) trouvée(s) — voir le détail ci-dessus.`);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    await listCampagnes();
    return;
  }
  await check(arg);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
