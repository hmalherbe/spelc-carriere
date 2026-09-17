import { AVIS_LABELS, formatAnneesDecimalesText, formatDureeEncodedText } from "@spelc/domain";
import {
  buildElusFooter,
  buildHeader,
  buildSocialLinks,
  buildUnsubscribeLink,
  civilitePrefix,
  escapeHtml,
  formatDateFr,
  type MailingElu,
  type MailingSocialLink,
} from "./template.js";

/**
 * Reconstructed from the union's own Word mail-merge model ("Lettre_Modele_CCMA_25-03-2026.docx")
 * — every MERGEFIELD and every nested IF field in that document maps to one field or one derived
 * value below. See the comments on each block builder for which paragraph of the original letter
 * it reproduces and under which condition.
 *
 * CCMA-only for now: the intro paragraph states the union's CCMA seat count ("3 sièges sur 5"),
 * which has no confirmed CCMI equivalent — this template refuses to render for a CCMI recipient
 * rather than guess that wording (see buildCcmaModelEmail).
 */
export type BonificationState = "ANCIENNETE" | "BONIFICATION" | "NON_PROMU";

export interface DernierPromuBaComparaison {
  bareme: number;
  ancienneteGrade: number;
  ancienneteEchelon: number;
}

export interface CcmaModelContext {
  civilite: string | null;
  prenom: string;
  nom: string;
  email: string | null;
  isAdherent: boolean;
  commission: "CCMA" | "CCMI";
  elus: MailingElu[];
  t1Text: string | null;
  logoDataUrl: string | null;
  socialLinks: MailingSocialLink[];

  dateCcma: string | null; // ISO

  grade: string;
  echelonDepart: string;
  echelonSuivant: string;
  gainSalaireNet: number;
  dateAccesEchelonActuel: string | null; // ISO — date à laquelle l'échelon actuel a été atteint
  dateEffetCcm: string | null; // ISO — date d'effet de la promotion annoncée dans ce courrier

  /** AN / CL / BA / RE, tel qu'imprimé par le rectorat. */
  typePromotion: string | null;
  /** "XXaYYmZZj" — n'a le sens d'un report d'ancienneté que lorsque typePromotion === "RE". */
  dureeRestanteEncoded: string | null;

  bonification: BonificationState;
  /** Date à laquelle la bonification d'ancienneté devenait possible (marqueur "BA."/"Pro BA." du rectorat). */
  dateEligibiliteBA: string | null; // ISO
  /** Pourcentage de promouvables BA effectivement retenus dans ce groupe (grade + échelon), calculé
   * automatiquement — remplace le "30 %" saisi à la main dans le modèle Word d'origine. */
  pourcentagePromusBa: number | null;

  bareme: number | null; // avisEvaluation (0-4)
  ancienneteGrade: number | null;
  ancienneteEchelon: number | null;
  /** Le pair déjà confirmé promu (Pro BA.) avec le barème/ancienneté le plus bas du même groupe —
   * sert uniquement à expliquer un départage, jamais à estimer le statut de qui que ce soit. */
  dernierPromu: DernierPromuBaComparaison | null;

  dateFuturePromotion: string | null; // ISO
  dateFuturePromotionSiBA: string | null; // ISO
}

function p(html: string): string {
  return `<p>${html}</p>`;
}

/** Bloc "Report d'ancienneté" — affiché seulement quand le rectorat a marqué ce record "RE."
 * (voir formatDureeEncodedText et son commentaire : confirmé sur un cas réel, MOLENAT Marion). */
function buildReportAncienneteBlock(ctx: CcmaModelContext): string {
  if (ctx.typePromotion !== "RE") return "";
  const report = formatDureeEncodedText(ctx.dureeRestanteEncoded);
  if (!report) return "";
  const dateDerniere = formatDateFr(ctx.dateAccesEchelonActuel);
  if (!dateDerniere) return "";
  return p(`Au ${dateDerniere} vous aviez un report d'ancienneté de ${escapeHtml(report)}.`);
}

/** Passage normal par les durées du PPCR (pas de bonification en jeu). */
function buildPassageNormalBlock(ctx: CcmaModelContext): string {
  if (ctx.bonification !== "ANCIENNETE") return "";
  const dateEffet = formatDateFr(ctx.dateEffetCcm);
  if (!dateEffet) return "";
  return p(
    `Votre passage à l'échelon <strong>${escapeHtml(ctx.echelonSuivant)}</strong>, prévu par les durées du PPCR est acté au ${dateEffet}.`,
  );
}

/** Informe qu'une candidature à la bonification d'ancienneté existait, indépendamment du résultat
 * (les blocs "accordée"/"non promu" ci-dessous disent lequel). */
function buildPromouvableBaBlock(ctx: CcmaModelContext): string {
  const dateEligibilite = formatDateFr(ctx.dateEligibiliteBA);
  if (!dateEligibilite) return "";
  return p(
    `À la date du ${dateEligibilite} vous étiez promouvable à l'échelon <strong>${escapeHtml(ctx.echelonSuivant)}</strong> avec une bonification d'ancienneté d'un an.`,
  );
}

function buildBonificationAccordeeBlock(ctx: CcmaModelContext): string {
  if (ctx.bonification !== "BONIFICATION") return "";
  const dateEligibilite = formatDateFr(ctx.dateEligibiliteBA);
  if (!dateEligibilite) return "";
  return p(
    `Nous avons le plaisir de vous annoncer que celle-ci a été acceptée. Vous passez à l'échelon <strong>${escapeHtml(ctx.echelonSuivant)}</strong> à la date du ${dateEligibilite}.`,
  );
}

/** "Votre prochaine promotion..." — un échelon plus loin que celui annoncé dans ce courrier,
 * avec la variante accélérée d'un an quand une fenêtre de bonification s'ouvre à l'échelon atteint. */
function buildProchainePromotionFutureBlock(ctx: CcmaModelContext): string {
  const dateNormale = formatDateFr(ctx.dateFuturePromotion);
  if (!dateNormale) return "";
  const dateAcceleree = formatDateFr(ctx.dateFuturePromotionSiBA);
  if (!dateAcceleree) {
    return p(`Votre prochaine promotion dans ce grade est prévue le : ${dateNormale}.`);
  }
  return p(
    `Votre prochaine promotion est possible soit le ${dateAcceleree} avec l'accélération de carrière d'un an du PPCR, ou à défaut le ${dateNormale}.`,
  );
}

/** Gain salarial + régularisation financière + prochaine promotion future — affiché pour tout le
 * monde SAUF un candidat BA non retenu (qui n'a, cette fois-ci, aucune promotion à annoncer). */
function buildGainEtSuiteBlock(ctx: CcmaModelContext): string {
  if (ctx.bonification === "NON_PROMU") return "";
  const parts: string[] = [];
  if (ctx.gainSalaireNet > 0) {
    const dateEffet = formatDateFr(ctx.dateEffetCcm);
    parts.push(
      p(
        `L'écart sur votre traitement de base consécutif à cette promotion pour un temps plein est équivalent à environ <strong>${ctx.gainSalaireNet} € nets</strong> par mois (avant prélèvement à la source).` +
          (dateEffet ? ` La régularisation financière devrait intervenir au plus tôt en ${monthYearFr(ctx.dateEffetCcm)}.` : ""),
      ),
    );
  }
  parts.push(buildProchainePromotionFutureBlock(ctx));
  return parts.join("\n");
}

function monthYearFr(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/** Message pour un candidat BA non retenu cette fois-ci — explique s'il n'y a eu aucun promu du
 * tout dans ce groupe, ou donne le taux de réussite réel (calculé, pas saisi à la main). */
function buildNonPromuBlock(ctx: CcmaModelContext): string {
  if (ctx.bonification !== "NON_PROMU") return "";
  if (ctx.pourcentagePromusBa == null || ctx.pourcentagePromusBa === 0) {
    return p(
      "Malheureusement il n'y a eu aucun promu à la bonification d'ancienneté car il n'y avait pas suffisamment de promouvables.",
    );
  }
  const dateEffet = formatDateFr(ctx.dateEffetCcm);
  return [
    p(
      `Malheureusement seuls ${ctx.pourcentagePromusBa} % des promouvables ont obtenu cette accélération de carrière sur la base des évaluations à la suite du rendez-vous de carrière` +
        (dateEffet
          ? `, la ${escapeHtml(ctx.commission)} de l'année prochaine actera votre passage à l'échelon <strong>${escapeHtml(ctx.echelonSuivant)}</strong> à la date du ${dateEffet}.`
          : "."),
    ),
    p("Les critères discriminants appliqués pour deux appréciations équivalentes sont l'ancienneté dans le grade et ensuite l'ancienneté dans l'échelon."),
  ].join("\n");
}

/** Comparaison barème / ancienneté avec le dernier promu du même groupe — transparence sur le
 * départage, jamais affichée pour quelqu'un qui n'était même pas candidat BA (bonification=ANCIENNETE). */
function buildComparaisonBaremeBlock(ctx: CcmaModelContext): string {
  if (ctx.bonification === "ANCIENNETE") return "";
  if (ctx.bareme == null || !ctx.dernierPromu) return "";

  const appreciation = AVIS_LABELS[ctx.bareme] ? `(${AVIS_LABELS[ctx.bareme].toLowerCase()} lors de votre dernier rendez-vous de carrière)` : "";
  const parts: string[] = [
    p(`Votre barème : <strong>${ctx.bareme}</strong> ${escapeHtml(appreciation)}`),
    p(`Le barème du dernier promu : <strong>${ctx.dernierPromu.bareme}</strong>`),
  ];

  if (ctx.bareme !== ctx.dernierPromu.bareme || ctx.ancienneteGrade == null) return parts.join("\n");

  const ancGradeTexte = formatAnneesDecimalesText(ctx.ancienneteGrade);
  const ancGradeDernierTexte = formatAnneesDecimalesText(ctx.dernierPromu.ancienneteGrade);
  parts.push(p(`Votre ancienneté dans le grade : <strong>${ancGradeTexte}</strong>`));
  parts.push(p(`Ancienneté dans le grade du dernier promu : <strong>${ancGradeDernierTexte}</strong>`));

  if (ctx.ancienneteGrade !== ctx.dernierPromu.ancienneteGrade || ctx.ancienneteEchelon == null) return parts.join("\n");

  const ancEchelonTexte = formatAnneesDecimalesText(ctx.ancienneteEchelon);
  const ancEchelonDernierTexte = formatAnneesDecimalesText(ctx.dernierPromu.ancienneteEchelon);
  parts.push(p(`Votre ancienneté dans l'échelon : <strong>${ancEchelonTexte}</strong>`));
  parts.push(p(`Ancienneté dans l'échelon du dernier promu : <strong>${ancEchelonDernierTexte}</strong>`));

  return parts.join("\n");
}

export class CcmaModelUnavailableError extends Error {}

export function buildCcmaModelEmail(ctx: CcmaModelContext): { subject: string; html: string } {
  if (ctx.commission !== "CCMA") {
    throw new CcmaModelUnavailableError(
      "Le modèle CCMA n'est pas encore disponible pour la CCMI (composition/texte d'intro non confirmés) — utilisez le modèle générique.",
    );
  }

  const dateCcmaFr = formatDateFr(ctx.dateCcma) ?? "";
  const civiliteLabel = civilitePrefix(ctx.civilite);
  const nom = escapeHtml(ctx.nom);
  const prenom = escapeHtml(ctx.prenom);
  const salutation = civiliteLabel ? `${civiliteLabel} ${nom},` : `${prenom} ${nom},`;

  const subject = `Spelc Côte d'Azur - CCMA du ${dateCcmaFr} : avancements`;

  const header = buildHeader(ctx.logoDataUrl, ctx.t1Text);
  const elusFooter = buildElusFooter(ctx.commission, ctx.elus);
  const unsubscribeLink = buildUnsubscribeLink(ctx.isAdherent);
  const socialLinks = buildSocialLinks(ctx.socialLinks);

  const body = [
    p(`<strong>CCMA du ${dateCcmaFr}</strong>`),
    p(`${prenom} ${nom},`),
    ctx.email ? p(escapeHtml(ctx.email)) : "",
    p(salutation),
    p(
      "La CCMA de ce jour a examiné votre situation d'avancement d'échelon. Le Spelc, syndicat majoritaire et représenté avec 3 sièges sur 5, s'est assuré de la conformité des données étudiées et a le plaisir de vous communiquer votre nouvelle situation :",
    ),
    p(`Vous étiez à l'échelon <strong>${escapeHtml(ctx.echelonDepart)}</strong> de l'échelle de rémunération : ${escapeHtml(ctx.grade)}.`),
    buildReportAncienneteBlock(ctx),
    buildPassageNormalBlock(ctx),
    buildPromouvableBaBlock(ctx),
    buildBonificationAccordeeBlock(ctx),
    buildGainEtSuiteBlock(ctx),
    buildNonPromuBlock(ctx),
    buildComparaisonBaremeBlock(ctx),
    p(
      "La commission consultative n'émet qu'un avis consultatif en attendant la décision officielle de l'administration qui vous sera notifiée prochainement par la voie hiérarchique.",
    ),
    p("Nous sommes à votre disposition pour de plus amples informations."),
    p("Bien cordialement,<br>Le Spelc"),
  ]
    .filter((block) => block !== "")
    .join("\n");

  const html = `
    ${header}
    ${body}
    ${elusFooter}
    ${unsubscribeLink}
    ${socialLinks}
  `.trim();

  return { subject, html };
}
