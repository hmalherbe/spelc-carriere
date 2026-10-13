/**
 * Diagnostic ponctuel : pour une campagne donnée, explique pourquoi la page Reliquats peut
 * n'afficher aucun candidat — cette page ne montre que les TeacherSnapshot dont computeBaStatus()
 * (baStatus.ts) renvoie EXACTEMENT "non_promu" (jamais "promu"/null), calculé EN DIRECT à partir des
 * champs bruts (echelonActuel, proTypePromotion, proConfirmee) — pas depuis la colonne
 * ComputedPromotionState.baStatus stockée, et depuis le marqueur du rectorat seul : l'ancienneté
 * dans l'échelon n'entre plus du tout dans ce calcul (voir baStatus.ts's own doc comment,
 * 2026-10-13). Affiche la distribution de ces champs bruts et le baStatus qui en résulte pour chaque
 * enregistrement candidat BA (proTypePromotion ou typePromotion = "BA"), pour voir exactement où ça
 * coince (échelon encore mal dérivé, marqueur absent, etc.) sans deviner.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/diagReliquatsBa.ts <campagneId>
 *   npx tsx scripts/diagReliquatsBa.ts --list     (pour retrouver un campagneId)
 */
import { PrismaClient } from "@prisma/client";
import { computeBaStatus } from "../src/baStatus.js";

const prisma = new PrismaClient();

async function listCampagnes() {
  const campagnes = await prisma.campagne.findMany({ orderBy: [{ periodeDebut: "desc" }] });
  for (const c of campagnes) {
    console.log(`${c.id}  ${c.type ?? "?"}  ${c.anneeScolaire}  CCMA du ${c.dateCcma.toISOString().slice(0, 10)}`);
  }
}

async function diag(campagneId: string) {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) {
    console.error(`Campagne introuvable : ${campagneId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Campagne : ${campagne.type ?? "?"} ${campagne.anneeScolaire} (CCMA du ${campagne.dateCcma.toISOString().slice(0, 10)})\n`);

  const snapshots = await prisma.teacherSnapshot.findMany({ where: { campagneId } });
  console.log(`${snapshots.length} TeacherSnapshot au total pour cette campagne.\n`);

  // "Candidat BA" au sens large (comme baCandidateStats.ts) — n'importe lequel des deux marqueurs.
  const candidates = snapshots.filter((s) => s.typePromotion === "BA" || s.proTypePromotion === "BA");
  console.log(`${candidates.length} enregistrement(s) avec typePromotion="BA" ou proTypePromotion="BA".\n`);

  if (candidates.length === 0) {
    console.log("Aucun candidat BA du tout dans cette campagne (ni typePromotion ni proTypePromotion ne valent \"BA\") —");
    console.log("la page Reliquats n'a donc rien à montrer : ce n'est pas un bug, il n'y a simplement aucun candidat BA");
    console.log("dans le fichier rectorat importé pour cette campagne.");
    return;
  }

  const echelonCounts = new Map<string, number>();
  const baStatusCounts = new Map<string, number>();
  const rows: string[] = [];

  for (const s of candidates) {
    echelonCounts.set(s.echelonActuel, (echelonCounts.get(s.echelonActuel) ?? 0) + 1);

    const { baEchelonDepart, baStatus } = computeBaStatus({
      echelonActuel: s.echelonActuel,
      grade: s.grade,
      proTypePromotion: s.proTypePromotion,
      proConfirmee: s.proConfirmee,
      ancienneteEchelon: s.ancienneteEchelon,
      reliquatPromu: false, // reliquats.ts calcule toujours avec reliquatPromu=false pour le pool éligible
    });
    const key = baStatus ?? "null";
    baStatusCounts.set(key, (baStatusCounts.get(key) ?? 0) + 1);

    rows.push(
      `  ${s.nomUsage} ${s.prenom} — echelonActuel="${s.echelonActuel}" typePromotion=${s.typePromotion} ` +
        `proTypePromotion=${s.proTypePromotion} proConfirmee=${s.proConfirmee} ancienneteEchelon=${s.ancienneteEchelon} ` +
        `=> baEchelonDepart=${baEchelonDepart} baStatus=${baStatus}`,
    );
  }

  console.log("Répartition de echelonActuel parmi ces candidats BA :");
  for (const [ech, n] of [...echelonCounts.entries()].sort()) console.log(`  "${ech}": ${n}`);
  console.log(
    "\n  (computeBaStatus n'accepte QUE \"06\"/\"6\" ou \"08\"/\"8\" comme échelon de départ BA — toute autre",
  );
  console.log('  valeur ici, notamment "07"/"09" (échelon d\'arrivée, bug corrigé par deriveEchelonActuelFromProjection),');
  console.log("  donne baEchelonDepart=null et exclut le candidat de la page Reliquats comme du tableau de bord.\n");

  console.log("Répartition de baStatus (calculé en direct, reliquatPromu=false) parmi ces candidats BA :");
  for (const [k, n] of baStatusCounts) console.log(`  ${k}: ${n}`);
  console.log('\n  (seuls les "non_promu" apparaissent dans le pool Reliquats — "promu"/"null" en sont exclus');
  console.log("  par construction, voir reliquats.ts. L'ancienneté dans l'échelon n'entre plus dans ce calcul : un");
  console.log('  marqueur "BA." non confirmé est toujours "non_promu", quelle que soit ancienneteEchelon.)\n');

  console.log("Détail ligne par ligne :");
  for (const r of rows) console.log(r);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    await listCampagnes();
    return;
  }
  await diag(arg);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
