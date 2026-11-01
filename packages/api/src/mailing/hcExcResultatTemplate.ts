import {
  buildElusElectionNotice,
  buildElusFooter,
  buildGreeting,
  buildHeader,
  buildSocialLinks,
  buildUnsubscribeLink,
  escapeHtml,
  formatDateFr,
  type MailingElu,
  type MailingSocialLink,
} from "./template.js";

/**
 * Reconstructed from the union's own Word mail-merge model for le résultat de la CCMA/CCMI Hors
 * Classe/Classe Exceptionnelle ("Modele_lettre_HC_CCMA_du_12_juin_2025.docx") — chaque MERGEFIELD
 * et chaque champ IF imbriqué de ce document correspond à un bloc ou une valeur dérivée ci-dessous.
 *
 * Un Agrégé n'a ni rang ni contingent affichés dans le document source (le processus de sélection
 * des agrégés — liste d'aptitude ministérielle — n'en comporte pas) : `estAgrege` reproduit ce
 * garde-fou exactement. Le document source fourni ne couvrait que la Hors Classe ; la Classe
 * Exceptionnelle est supposée suivre la même structure (confirmé par les classeurs réels, qui
 * partagent la même feuille "Mailing" et les mêmes colonnes pour les deux processus) — à corriger
 * si un modèle EXC réel s'avère différent sur ce point précis.
 */
export interface HcExcResultatContext {
  civilite: string | null;
  prenom: string;
  nom: string;
  email: string | null;
  isAdherent: boolean;
  /** Voir MailingContext.unsubscribeUrl (template.ts) — même contrat. */
  unsubscribeUrl: string | null;
  commission: "CCMA" | "CCMI";
  elus: MailingElu[];
  t1Text: string | null;
  logoDataUrl: string | null;
  socialLinks: MailingSocialLink[];

  processus: "HC" | "EXC";
  dateCcma: string | null; // ISO
  /** ISO — date d'effet de la promotion annoncée (1er septembre de l'année scolaire de la campagne). */
  dateEffet: string | null;
  /** Libellé d'affichage du grade/échelle, tel qu'imprimé par le rectorat (ex. "PEPS", "Certifié",
   * "Agrégé") — PAS le code interne de grille. */
  grade: string;
  estAgrege: boolean;

  /** Null pour un Agrégé (non affiché — voir estAgrege). */
  rang: number | null;
  contingent: number | null;
  appreciationRecteur: string | null;
  pointsRecteur: number | null;
  /** Marqueur "Choix du Recteur" du fichier rectorat ("P") — décide la promotion annoncée dans
   * cette lettre, indépendamment de tout calcul de contingent fait ailleurs dans l'appli. */
  choixRecteur: boolean;
  pointsAnciennete: number | null;
  totalBareme: number | null;
}

function p(html: string): string {
  return `<p>${html}</p>`;
}

function processusLabel(processus: "HC" | "EXC"): string {
  return processus === "HC" ? "la Hors Classe" : "la Classe Exceptionnelle";
}

function processusLabelCourt(processus: "HC" | "EXC"): string {
  return processus === "HC" ? "hors classe" : "classe exceptionnelle";
}

function buildIntroParagraph(ctx: HcExcResultatContext): string {
  const dateCcmaFr = formatDateFr(ctx.dateCcma) ?? "cette date";
  const spelcClause = ctx.commission === "CCMA" ? ", syndicat majoritaire et représenté avec 3 sièges sur 5," : "";
  return p(
    `Votre situation a été examinée lors de la ${escapeHtml(ctx.commission)} du ${dateCcmaFr} pour l'accès à ${processusLabel(ctx.processus)} réservée à l'échelle de rémunération de ${escapeHtml(ctx.grade)}.` +
      `<br>Vos élus Spelc${spelcClause} se sont assurés de la conformité de votre barème et vous transmettent donc les informations suivantes :`,
  );
}

function buildRangContingentBlock(ctx: HcExcResultatContext): string {
  if (ctx.estAgrege) return "";
  const lines: string[] = [];
  if (ctx.rang != null) lines.push(`Votre rang est : <strong>${ctx.rang}</strong>.`);
  if (ctx.contingent != null) lines.push(`Le nombre de promus pour l'échelle de rémunération ${escapeHtml(ctx.grade)} est : <strong>${ctx.contingent}</strong>.`);
  return lines.length > 0 ? p(lines.join("<br>")) : "";
}

function buildBaremeBlock(ctx: HcExcResultatContext): string {
  const lines: string[] = [];
  if (ctx.appreciationRecteur != null && ctx.pointsRecteur != null) {
    lines.push(`L'appréciation du Recteur est « ${escapeHtml(ctx.appreciationRecteur)} », ce qui correspond à ${ctx.pointsRecteur} points*.`);
  }
  if (!ctx.choixRecteur) {
    lines.push("Cette appréciation sera prise en compte pour la prochaine campagne de promotion.");
  }
  if (ctx.pointsAnciennete != null) {
    lines.push(`Les points d'ancienneté dans votre échelon correspondent à ${ctx.pointsAnciennete} points.`);
  }
  if (ctx.totalBareme != null) {
    lines.push(`Le total de votre barème est <strong>${ctx.totalBareme}</strong> points.`);
  }
  if (lines.length === 0) return "";
  lines.push("Les promotions attribuées ont pris en compte la proportion femmes – hommes du contingent des promouvables.");
  return p(lines.join("<br>"));
}

function buildDecisionBlock(ctx: HcExcResultatContext): string {
  if (!ctx.choixRecteur) {
    return p(`Vous n'avez pas été promu(e) à ${processusLabelCourt(ctx.processus)}.`);
  }
  if (ctx.estAgrege) {
    return p("Votre candidature sera proposée au ministère.");
  }
  const dateEffetFr = formatDateFr(ctx.dateEffet);
  return p(
    `Vous êtes promu(e) à ${processusLabelCourt(ctx.processus)}${dateEffetFr ? ` au ${dateEffetFr}` : ""}.` +
      " Le Spelc Côte d'Azur enverra à ses adhérents promus le calcul du reclassement et l'impact financier consécutif.",
  );
}

export function buildHcExcResultatEmail(ctx: HcExcResultatContext): { subject: string; html: string } {
  const dateCcmaFr = formatDateFr(ctx.dateCcma) ?? "";
  const greeting = buildGreeting(ctx.civilite, ctx.isAdherent, ctx.prenom, ctx.nom);

  const subject = `Spelc Côte d'Azur - ${ctx.commission} du ${dateCcmaFr} : ${processusLabelCourt(ctx.processus)}`;

  const header = buildHeader(ctx.logoDataUrl, ctx.t1Text);
  const electionNotice = buildElusElectionNotice(ctx.commission);
  const elusFooter = buildElusFooter(ctx.commission, ctx.elus);
  const unsubscribeLink = buildUnsubscribeLink(ctx.unsubscribeUrl);
  const socialLinks = buildSocialLinks(ctx.socialLinks);

  const body = [
    p(`<strong>${escapeHtml(ctx.commission)} du ${dateCcmaFr}</strong>`),
    ctx.email ? `<p style="font-size: 0.8rem;">${escapeHtml(ctx.email)}</p>` : "",
    greeting,
    buildIntroParagraph(ctx),
    buildRangContingentBlock(ctx),
    buildBaremeBlock(ctx),
    buildDecisionBlock(ctx),
    p("Le Spelc Côte d'Azur a vérifié tous les barèmes de ses adhérents."),
    `<p style="font-size: 0.8rem;">* L'appréciation du Recteur peut faire l'objet d'un recours dans les délais réglementaires.</p>`,
  ]
    .filter((block) => block !== "")
    .join("\n");

  const html = `
    ${header}
    ${body}
    ${electionNotice}
    ${elusFooter}
    ${unsubscribeLink}
    ${socialLinks}
  `.trim();

  return { subject, html };
}
