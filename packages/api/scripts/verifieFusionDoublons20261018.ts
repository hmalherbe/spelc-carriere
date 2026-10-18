/**
 * Vérification ponctuelle (2026-10-18) : confirme si fusionneDoublonsAdherents20261018.ts --apply a
 * bien été exécuté, en relisant la même liste PAIRES et en regardant, pour chaque paire, laquelle
 * des deux fiches existe encore. Purement en lecture, ne modifie rien.
 *
 * Usage (depuis packages/api, sur le serveur où tourne l'appli) :
 *   npx tsx scripts/verifieFusionDoublons20261018.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Même liste que fusionneDoublonsAdherents20261018.ts.
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

async function main() {
  let fusionnees = 0;
  let nonFusionnees = 0;
  let disparuesEnsemble = 0;

  for (const [idA, idB] of PAIRES) {
    const [a, b] = await Promise.all([
      prisma.adherent.findUnique({ where: { id: idA }, select: { nom: true, prenom: true } }),
      prisma.adherent.findUnique({ where: { id: idB }, select: { nom: true, prenom: true } }),
    ]);

    if (!a && !b) {
      console.log(`[?] ${idA} / ${idB} : les deux fiches sont absentes — déjà fusionnée via un autre mécanisme, ou données modifiées depuis.`);
      disparuesEnsemble++;
    } else if (a && b) {
      console.log(`[PAS FUSIONNÉ] ${a.nom} ${a.prenom} : les deux fiches existent encore (${idA} et ${idB}).`);
      nonFusionnees++;
    } else {
      const restante = a ?? b!;
      console.log(`[fusionné] ${restante.nom} ${restante.prenom} : une seule fiche restante, comme attendu.`);
      fusionnees++;
    }
  }

  console.log(`\n${fusionnees} / ${PAIRES.length} paires fusionnées, ${nonFusionnees} encore en double, ${disparuesEnsemble} cas à vérifier à part (les deux id absents).`);
  if (nonFusionnees > 0) {
    console.log(`\n--apply n'a vraisemblablement pas été exécuté (ou que partiellement) — relancer : npx tsx scripts/fusionneDoublonsAdherents20261018.ts --apply`);
  } else if (disparuesEnsemble === 0) {
    console.log("\nLe merge a bien été appliqué pour les 25 paires.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
