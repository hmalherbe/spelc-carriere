/**
 * Correctif ponctuel (2026-10-18) : fusionne les doublons de fiche adhérent repérés par
 * auditDoublonsAdherents.ts (23 paires "quasi certain" + 2 paires "à vérifier"), causés par
 * l'ancienne clé d'upsert à correspondance exacte de adherentImport.ts (voir son propre
 * correctif, même date) — désormais corrigée pour les futurs imports, mais les doublons déjà créés
 * doivent être nettoyés une fois.
 *
 * Règle de fusion pour chaque paire (garde une seule fiche, supprime l'autre) :
 *   1. Si l'une des deux a un MatchCandidate CONFIRMED (revu par un humain) et pas l'autre : garde
 *      celle-là, quoi qu'il arrive — un rapprochement validé par un humain est intouchable.
 *   2. Sinon, si l'une a un MatchCandidate AUTO_CONFIRMED et l'autre non : garde celle-là.
 *   3. Sinon (aucune des deux n'a de lien fiable, ou les deux ont le MÊME niveau de fiabilité) :
 *      garde celle avec la date d'effet la plus récente (la donnée la plus à jour).
 *   4. Si les deux ont un lien fiable (CONFIRMED/AUTO_CONFIRMED) mais vers des enseignants
 *      DIFFÉRENTS : conflit réel, ne fusionne PAS — affiché pour traitement manuel.
 *
 * La fiche supprimée voit son MatchCandidate (relation obligatoire) supprimé d'abord pour
 * satisfaire la contrainte de clé étrangère ; son éventuel historique de mailing (MailingLog,
 * chaîne historique sans vraie FK, voir adherentImport.ts) reste tel quel, inchangé.
 *
 * Usage :
 *   npx tsx scripts/fusionneDoublonsAdherents20261018.ts            (aperçu, ne modifie rien)
 *   npx tsx scripts/fusionneDoublonsAdherents20261018.ts --apply    (applique réellement)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Les paires détectées par auditDoublonsAdherents.ts le 2026-10-18 (catégorie "quasi certain" +
// les 2 de "à vérifier", déjà confirmées à l'œil : mêmes nom/prénom à l'accent près).
const PAIRES: [string, string][] = [
  ["cmvb0lfqv0016ctd68atz6qnu", "cmvcd2mye0313txycsku1lm0o"], // BARACHET Charlene/Charlène
  ["cmvb0lgsx005actd6e47xbmsu", "cmvcd2oho0323txycgbumhoxo"], // COLONNA Francois-Marie/François-Marie
  ["cmvb0lfrm0018ctd6lwyqh6h6", "cmvcd2mz50314txycv0800dgl"], // BARBARO Loic/Loïc
  ["cmvb0lg5v002qctd677y40goa", "cmvcd2nky031ftxyc0hcvr0zh"], // BLASCO MARIN/BLASCO-MARIN Vanessa
  ["cmvb0lgcv003kctd6mmixeugf", "cmvcd2nsj031mtxycib59a1uw"], // BRUNO Oceane/Océane
  ["cmvb0lgo6004tctd6qc5b8zco", "cmvcd2o9c031utxych2zlmw17"], // CHAULE/CHAULÉ Philippe
  ["cmvb0lgpf004yctd65r77yszb", "cmvcd2od5031ytxycs5d7bo5y"], // CHOVE/CHOVÉ Anne-Sophie
  ["cmvb0lh1l0064ctd6ohbtat0g", "cmvcd2osb0329txycjat9ahxm"], // DE ROQUEFEUIL Berengere/Bérengère
  ["cmvb0lhkw007uctd6ac376r3i", "cmvcd2piw032ptxyclweu180e"], // ESTEVE/ESTÈVE Stéphanie
  ["cmvb0lht8008jctd6ov7vp9mg", "cmvcd2pr8032stxycu0buslcn"], // FOULADVIND Marjan/Marjane
  ["cmvb0li3j009kctd6gkgcusgg", "cmvcd2q610333txyc9b6v5zn0"], // GOUVERNET/GOURVERNET Magali
  ["cmvb0li43009mctd60u3fdnfm", "cmvcd2q7o0334txycofb7pcu8"], // GRANGER-DELACROIX Anais/Anaïs
  ["cmvb0li1a009bctd6lh1avmeh", "cmvcd2q1x0330txycuojziey0"], // GIRARD Eric/Éric
  ["cmvb0lied00amctd6salqmvba", "cmvcd2qnw033etxycg8zn6x3b"], // JACOUD Gwennaelle/Gwennaëlle
  ["cmvb0litz00bpctd69qh7rist", "cmvcd2r5b033ltxycd47023ih"], // LADREYT Chloee/Chloée
  ["cmvb0lkx800iqctd6pmkc4zxl", "cmvcd2u18035btxyc13a7wjap"], // SALIBA Anais/Anaïs
  ["cmvb0ljci00d9ctd6fcsspqos", "cmvcd2pzp032ytxycgl11ctdy"], // LOTMANI/GIACOMINI Myriam (nom marital)
  ["cmvb0ljme00eactd6n79r7la3", "cmvcd2sby034btxycbqvt7qs9"], // MEZZETTI Elisabeth/Élisabeth
  ["cmvb0ljq000enctd694k6nhs4", "cmvcd2si8034gtxycoq03o719"], // MONTANI Valeria/Valéria
  ["cmvb0ljv200f9ctd6lhyxpjoq", "cmvcd2sqa034ltxyc44jx3msy"], // NICOLAI/NICOLAÏ Pierre
  ["cmvb0llls00ljctd6e75n6lx9", "cmvcd2uxi0361txyciv9t117g"], // ZANARELLI Marie-Amelie/Marie-Amélie
  ["cmvb0lkfz00h4ctd64elco32p", "cmvcd2tfu0351txyci6q4thg4"], // QUATTRONE Solene/Solène
  ["cmvb0ll8b00k1ctd63kpsg5a6", "cmvcd2o93031ttxyc63etwdyr"], // THOMPSON/CHARRON TRABI Marie-Chantal (nom marital)
  ["cmvb0lgsq0059ctd61oa0r04n", "cmvcd2oh50321txycp3d57awx"], // COLOMBIER-BON Nadege/Nadège
  ["cmvb0liio00azctd661t49viq", "cmvcd2qsv033ftxycva05c356"], // JOST Gregory/Grégory
];

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "Mode APPLICATION — les suppressions seront réellement effectuées.\n" : "Mode APERÇU (ajoutez --apply pour exécuter réellement).\n");

  let fusionnees = 0;
  let conflits = 0;

  for (const [idA, idB] of PAIRES) {
    const [a, b] = await Promise.all([
      prisma.adherent.findUnique({ where: { id: idA }, include: { matchCandidate: true } }),
      prisma.adherent.findUnique({ where: { id: idB }, include: { matchCandidate: true } }),
    ]);
    if (!a || !b) {
      console.log(`[absent] ${idA} / ${idB} — déjà traité ou supprimé, ignoré.`);
      continue;
    }

    const rang = (status: string | undefined): number => (status === "CONFIRMED" ? 3 : status === "AUTO_CONFIRMED" ? 2 : 1);
    const rangA = rang(a.matchCandidate?.status);
    const rangB = rang(b.matchCandidate?.status);

    let garder: typeof a;
    let supprimer: typeof a;

    if (rangA !== rangB) {
      [garder, supprimer] = rangA > rangB ? [a, b] : [b, a];
    } else if (rangA >= 2 && a.matchCandidate?.teacherId !== b.matchCandidate?.teacherId) {
      console.log(`[CONFLIT] ${a.nom} ${a.prenom} (${a.id}) vs ${b.nom} ${b.prenom} (${b.id}) : liens fiables vers des enseignants DIFFÉRENTS — à traiter manuellement.`);
      conflits++;
      continue;
    } else {
      const dateA = a.dateEffet?.getTime() ?? 0;
      const dateB = b.dateEffet?.getTime() ?? 0;
      [garder, supprimer] = dateA >= dateB ? [a, b] : [b, a];
    }

    console.log(`${garder.nom} ${garder.prenom} : garde ${garder.id} (statut=${garder.matchCandidate?.status ?? "aucun"}), supprime ${supprimer.id} (statut=${supprimer.matchCandidate?.status ?? "aucun"})`);

    if (APPLY) {
      if (supprimer.matchCandidate) {
        await prisma.matchCandidate.delete({ where: { adherentId: supprimer.id } });
      }
      await prisma.adherent.delete({ where: { id: supprimer.id } });
    }
    fusionnees++;
  }

  console.log(`\n${fusionnees} paire(s) fusionnée(s)${APPLY ? "" : " (simulation)"}, ${conflits} conflit(s) laissé(s) de côté pour revue manuelle.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
