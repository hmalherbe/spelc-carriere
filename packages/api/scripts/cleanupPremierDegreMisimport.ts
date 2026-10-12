/**
 * One-off cleanup for a real mis-import: a CCMI (premier degré, "Prof. Ecoles"/"Prof. Ecoles
 * HC"/"Prof. Ecoles EXC") rectorat file was uploaded into a CCMA (second degré) campagne by mistake.
 * A CCMA campagne can never legitimately contain these grades (they only exist for CCMI), so that's
 * the safe, sufficient identifying criterion — no campagneId needs to be known/guessed up front.
 *
 * Dry-run by default: reports exactly what it found and what it WOULD delete, but changes nothing.
 * Pass --confirm to actually delete. Aborts loudly instead of guessing if it finds anything outside
 * what a fresh, isolated mis-import should look like (a teacher with snapshots elsewhere too, any
 * MailingLog, any ReliquatPromotion) — those need a human decision, not a blind delete.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/cleanupPremierDegreMisimport.ts            (dry-run, n'écrit rien)
 *   npx tsx scripts/cleanupPremierDegreMisimport.ts --confirm  (supprime pour de vrai)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PREMIER_DEGRE_GRADES = ["Prof. Ecoles", "Prof. Ecoles HC", "Prof. Ecoles EXC"];

async function main() {
  const confirm = process.argv.includes("--confirm");

  const misimportedSnapshots = await prisma.teacherSnapshot.findMany({
    where: { grade: { in: PREMIER_DEGRE_GRADES }, campagne: { type: "CCMA" } },
    include: { campagne: true, teacher: true },
  });

  if (misimportedSnapshots.length === 0) {
    console.log("Aucun enseignant premier degré trouvé dans une campagne CCMA — rien à faire.");
    return;
  }

  const byCampagne = new Map<string, { label: string; count: number }>();
  for (const s of misimportedSnapshots) {
    const key = s.campagneId;
    const label = `${s.campagne.type ?? "?"} ${s.campagne.anneeScolaire} (CCMA du ${s.campagne.dateCcma.toISOString().slice(0, 10)})`;
    const entry = byCampagne.get(key) ?? { label, count: 0 };
    entry.count++;
    byCampagne.set(key, entry);
  }
  console.log("Campagnes CCMA affectées :");
  for (const [id, { label, count }] of byCampagne) {
    console.log(`  ${id}  ${label}  — ${count} enseignant(s) premier degré`);
  }

  const teacherIds = [...new Set(misimportedSnapshots.map((s) => s.teacherId))];
  console.log(`\n${teacherIds.length} identité(s) Teacher distincte(s) concernée(s).`);

  // Safety check: every one of these Teacher identities must have been created PURELY by the
  // mis-import — if one also has a snapshot OUTSIDE the affected set, deleting it would erase real,
  // legitimate history too. Abort rather than guess.
  const allSnapshotsForTeachers = await prisma.teacherSnapshot.findMany({
    where: { teacherId: { in: teacherIds } },
    select: { id: true, teacherId: true },
  });
  const misimportedSnapshotIds = new Set(misimportedSnapshots.map((s) => s.id));
  const extraneous = allSnapshotsForTeachers.filter((s) => !misimportedSnapshotIds.has(s.id));
  if (extraneous.length > 0) {
    console.error(
      `\nARRET : ${extraneous.length} TeacherSnapshot en dehors du périmètre détecté touchent les mêmes identités Teacher — ` +
        `ce ne sont peut-être pas des identités purement créées par le mauvais import. Vérifier manuellement avant de continuer.`,
    );
    process.exitCode = 1;
    return;
  }

  const [hcExc, computed, matches, mailingLogs, reliquats, imports] = await Promise.all([
    prisma.hcExcSnapshot.findMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.computedPromotionState.findMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.matchCandidate.findMany({ where: { teacherId: { in: teacherIds } }, include: { adherent: true } }),
    prisma.mailingLog.findMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.reliquatPromotion.findMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.rectoratImport.findMany({ where: { campagneId: { in: [...byCampagne.keys()] }, grade: { contains: "ECOLES" } } }),
  ]);

  console.log(`\nDonnées liées à supprimer :`);
  console.log(`  TeacherSnapshot      : ${misimportedSnapshots.length}`);
  console.log(`  HcExcSnapshot        : ${hcExc.length}`);
  console.log(`  ComputedPromotionState: ${computed.length}`);
  console.log(`  MatchCandidate       : ${matches.length} (rapprochement adhérent -> enseignant, sera annulé)`);
  console.log(`  MailingLog           : ${mailingLogs.length}${mailingLogs.some((m) => m.status === "SENT") ? "  /!\\ CONTIENT DES EMAILS ENVOYES" : ""}`);
  console.log(`  ReliquatPromotion    : ${reliquats.length}`);
  console.log(`  RectoratImport       : ${imports.length} (${imports.map((i) => i.fileName).join(", ")})`);

  if (matches.length > 0) {
    console.log("\nAdhérents dont le rapprochement sera annulé (ils redeviendront non rapprochés) :");
    for (const m of matches) {
      console.log(`  ${m.adherent.nom} ${m.adherent.prenom} (status actuel: ${m.status})`);
    }
  }

  if (mailingLogs.some((m) => m.status === "SENT")) {
    console.error(
      "\nARRET : au moins un e-mail a déjà été réellement ENVOYÉ à un de ces enseignants fantômes. " +
        "Supprimer ce journal effacerait la trace d'un envoi réel — à traiter manuellement.",
    );
    process.exitCode = 1;
    return;
  }
  if (reliquats.length > 0) {
    console.error(
      "\nARRET : au moins un ReliquatPromotion existe pour ces enseignants — c'est une décision manuelle de l'union, " +
        "à vérifier avant suppression plutôt que de la supprimer en aveugle.",
    );
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log("\n(dry-run — rien n'a été modifié ; relancer avec --confirm pour supprimer réellement)");
    return;
  }

  await prisma.$transaction([
    prisma.mailingLog.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.reliquatPromotion.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.computedPromotionState.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.matchCandidate.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.hcExcSnapshot.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.teacherSnapshot.deleteMany({ where: { teacherId: { in: teacherIds } } }),
    prisma.rectoratImport.deleteMany({ where: { id: { in: imports.map((i) => i.id) } } }),
    prisma.teacher.deleteMany({ where: { id: { in: teacherIds } } }),
  ]);

  console.log(`\nFait : ${teacherIds.length} enseignant(s) premier degré supprimé(s) de la/des campagne(s) CCMA ci-dessus.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
