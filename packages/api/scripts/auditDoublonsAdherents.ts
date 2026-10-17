/**
 * Audit : détecte d'éventuels autres doublons de fiche adhérent dans le genre de BITAR/BITTAR
 * (même personne réelle, deux fiches Adherent distinctes — typiquement une orthographe de nom
 * différente entre deux exports ADEL successifs, qui empêche l'upsert par nom+prénom exact de
 * adherentImport.ts de les reconnaître comme la même ligne). Purement en lecture, ne
 * modifie rien — à utiliser avant de corriger, pas à la place de regarder chaque cas.
 *
 * Deux niveaux de confiance :
 * - "Quasi certain" : même adresse mail personnelle, non vide, sur deux fiches avec un id différent
 *   — le signal le plus fiable (confirmé sur le cas réel BITAR/BITTAR : même email
 *   mbittar@outlook.fr).
 * - "À vérifier" : nom ET prénom très proches par similarité floue (même moteur que le
 *   rapprochement adhérent↔enseignant, voir @spelc/import), sans déjà matcher par email — plus de
 *   faux positifs possibles (deux personnes différentes avec un nom proche), à trancher au cas par
 *   cas plutôt qu'à corriger automatiquement.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/auditDoublonsAdherents.ts
 */
import { PrismaClient } from "@prisma/client";
import { nameSimilarity } from "@spelc/import";

const prisma = new PrismaClient();

const SEUIL_NOM = 0.75;
const SEUIL_PRENOM = 0.85;

interface AdherentLite {
  id: string;
  nom: string;
  prenom: string;
  nomNaissance: string | null;
  grade: string | null;
  mailPersonnel: string | null;
  ancienEchelon: string | null;
  dateEffet: Date | null;
}

function describe(a: AdherentLite): string {
  const date = a.dateEffet ? a.dateEffet.toISOString().slice(0, 10) : "—";
  return `${a.nom} ${a.prenom} (id=${a.id}, grade=${a.grade ?? "—"}, échelon=${a.ancienEchelon ?? "—"}, dateEffet=${date}, mail=${a.mailPersonnel ?? "—"})`;
}

async function main() {
  const adherents: AdherentLite[] = await prisma.adherent.findMany({
    select: { id: true, nom: true, prenom: true, nomNaissance: true, grade: true, mailPersonnel: true, ancienEchelon: true, dateEffet: true },
  });
  console.log(`${adherents.length} adhérents au total.\n`);

  const parEmail = new Map<string, AdherentLite[]>();
  for (const a of adherents) {
    if (!a.mailPersonnel) continue;
    const key = a.mailPersonnel.trim().toLowerCase();
    if (!parEmail.has(key)) parEmail.set(key, []);
    parEmail.get(key)!.push(a);
  }

  console.log("=== Quasi certain (même adresse mail) ===\n");
  let foundEmail = false;
  for (const [email, group] of parEmail) {
    if (group.length < 2) continue;
    foundEmail = true;
    console.log(`Mail : ${email}`);
    for (const a of group) console.log(`  - ${describe(a)}`);
    console.log("");
  }
  if (!foundEmail) console.log("Aucun.\n");

  console.log("=== À vérifier (nom + prénom très proches, pas déjà groupés par mail) ===\n");
  const dejaGroupes = new Set(
    [...parEmail.values()].filter((g) => g.length >= 2).flatMap((g) => g.map((a) => a.id)),
  );
  let foundFuzzy = false;
  for (let i = 0; i < adherents.length; i++) {
    for (let j = i + 1; j < adherents.length; j++) {
      const a = adherents[i];
      const b = adherents[j];
      if (dejaGroupes.has(a.id) && dejaGroupes.has(b.id)) continue; // déjà signalé ci-dessus
      const nomScore = Math.max(
        nameSimilarity(a.nom, b.nom),
        a.nomNaissance ? nameSimilarity(a.nomNaissance, b.nom) : 0,
        b.nomNaissance ? nameSimilarity(a.nom, b.nomNaissance) : 0,
      );
      if (nomScore < SEUIL_NOM) continue;
      const prenomScore = nameSimilarity(a.prenom, b.prenom);
      if (prenomScore < SEUIL_PRENOM) continue;
      if (a.nom === b.nom && a.prenom === b.prenom) continue; // même nom+prénom exact : une seule fiche possible (clé d'upsert), pas un doublon
      foundFuzzy = true;
      console.log(`nom=${nomScore.toFixed(2)} prenom=${prenomScore.toFixed(2)}`);
      console.log(`  - ${describe(a)}`);
      console.log(`  - ${describe(b)}`);
      console.log("");
    }
  }
  if (!foundFuzzy) console.log("Aucun.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
