import { bankingDaysToYMD, formatYmdText } from "@spelc/domain";
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
 * Reconstructed from les deux modèles Word de reclassement du syndicat ("Lettre_Reclassement_HC_
 * CCMA_du_12_juin_2025.docx" et son équivalent EXC) — les deux partagent EXACTEMENT la même
 * structure, seuls les noms de champs de fusion diffèrent entre les deux fichiers sources
 * (Echelon_reclassement/Date_future_promotion côté HC, Nouvel_echelon/Date_Prochaine_Promo côté
 * EXC) — un flottement de nommage du classeur, harmonisé ici en un seul jeu de champs.
 *
 * Envoyée UNIQUEMENT aux adhérents effectivement promus (voir routes/hcExcMailing.ts) — jamais aux
 * non-adhérents (le reclassement calculé est un service réservé aux adhérents, confirmé par
 * l'utilisateur) ni aux non-promus.
 */
export interface HcExcReclassementContext {
  civilite: string | null;
  prenom: string;
  nom: string;
  email: string | null;
  /** Toujours true en pratique (voir le doc comment ci-dessus) — gardé pour que buildGreeting
   * reste cohérent avec le reste de l'appli si jamais ce choix change un jour. */
  isAdherent: boolean;
  unsubscribeUrl: string | null;
  commission: "CCMA" | "CCMI";
  elus: MailingElu[];
  t1Text: string | null;
  logoDataUrl: string | null;
  socialLinks: MailingSocialLink[];

  dateCcma: string | null; // ISO
  /** ISO — date d'effet du reclassement (1er septembre de l'année scolaire de la campagne). */
  dateEffet: string | null;
  /** Libellé d'affichage du nouveau grade (ex. "AGREGE HC", "CERTIFIE EXC"). */
  nouveauGrade: string;
  nouvelEchelon: string;
  /** En jours comptables (360j/an) — voir computeReclassementHcExc.ancienneteReporteeJours. */
  ancienneteReporteeJours: number;
  gainSalaireNet: number;
  /** ISO, ou null si l'échelon atteint est déjà le plafond de sa grille (voir
   * computeReclassementHcExc.dateProchainePromotion). */
  dateProchainePromotion: string | null;
}

function p(html: string): string {
  return `<p>${html}</p>`;
}

function buildReportBlock(ctx: HcExcReclassementContext): string {
  if (ctx.ancienneteReporteeJours <= 0) return " sans report d'ancienneté.";
  const { annees, mois, jours } = bankingDaysToYMD(ctx.ancienneteReporteeJours);
  return ` avec un report d'ancienneté de ${escapeHtml(formatYmdText(annees, mois, jours))}.`;
}

function buildProchainePromotionBlock(ctx: HcExcReclassementContext): string {
  const dateFr = formatDateFr(ctx.dateProchainePromotion);
  if (!dateFr) return "";
  return p(`Votre prochaine promotion est prévue le : <strong>${dateFr}</strong>.`);
}

export function buildHcExcReclassementEmail(ctx: HcExcReclassementContext): { subject: string; html: string } {
  const dateCcmaFr = formatDateFr(ctx.dateCcma) ?? "";
  const dateEffetFr = formatDateFr(ctx.dateEffet) ?? "";
  const greeting = buildGreeting(ctx.civilite, ctx.isAdherent, ctx.prenom, ctx.nom);

  const subject = `Spelc Côte d'Azur - ${ctx.commission} du ${dateCcmaFr} : votre reclassement`;

  const header = buildHeader(ctx.logoDataUrl, ctx.t1Text);
  const electionNotice = buildElusElectionNotice(ctx.commission);
  const elusFooter = buildElusFooter(ctx.commission, ctx.elus);
  const unsubscribeLink = buildUnsubscribeLink(ctx.unsubscribeUrl);
  const socialLinks = buildSocialLinks(ctx.socialLinks);

  const body = [
    ctx.email ? `<p style="font-size: 0.8rem;">${escapeHtml(ctx.email)}</p>` : "",
    greeting,
    p(
      `Suite à la ${escapeHtml(ctx.commission)} du ${dateCcmaFr}, vous accédez au grade <strong>${escapeHtml(ctx.nouveauGrade)}</strong> à compter du ${dateEffetFr}.` +
        `<br>Voici votre reclassement au ${dateEffetFr} : échelon <strong>${escapeHtml(ctx.nouvelEchelon)}</strong>${buildReportBlock(ctx)}`,
    ),
    p(`Le gain de salaire net mensuel correspondant, pour un temps plein, est d'environ <strong>${ctx.gainSalaireNet} €</strong>.`),
    buildProchainePromotionBlock(ctx),
    p("N'hésitez pas à nous contacter si cela ne correspondait pas à l'arrêté de promotion."),
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
