export interface MailingElu {
  role: "TITULAIRE" | "SUPPLEANT";
  prenom: string;
  nom: string;
  telephone: string | null;
  email: string | null;
}

export interface MailingSocialLink {
  label: string;
  url: string;
}

/** Data needed to render one promotion-notification email. Pure/no I/O, so it's trivial to unit-test. */
export interface MailingContext {
  civilite: string | null;
  prenom: string;
  nom: string;
  grade: string;
  echelonDepart: string;
  echelonSuivant: string;
  indiceActuel: number;
  futurIndice: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  dateProchainePromotion: string | null; // ISO date
  anneeScolaire: string;
  /** Non-adhérent = never explicitly signed up with the union, so unlike an adhérent they get an
   * unsubscribe link in the footer (see buildPromotionEmail). */
  isAdherent: boolean;
  /** CCMA (second degré) or CCMI (premier degré) per the recipient's grade — decides which élus
   * list to show; null when the grade couldn't be classified (see routes/mailing.ts). */
  commission: "CCMA" | "CCMI" | null;
  /** Already filtered to `commission` by the caller — this module only renders. */
  elus: MailingElu[];
  t1Text: string | null;
  logoDataUrl: string | null;
  socialLinks: MailingSocialLink[];
}

/**
 * Escapes fields that ultimately come from imported CSV/PDF data (nom, prénom, grade) before they
 * are interpolated into the HTML body — those files aren't authored by us, so treat their content
 * as untrusted rather than assuming it can't contain markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateFr(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function civilitePrefix(civilite: string | null): string {
  if (!civilite) return "";
  const c = civilite.trim().toLowerCase();
  if (c.startsWith("mme")) return "Madame";
  if (c.startsWith("m")) return "Monsieur";
  return escapeHtml(civilite);
}

/**
 * Logo (left) + "t1" free text (right) — a table, not flex/grid, since that's the layout mode
 * every mail client (including Outlook's Word rendering engine) actually supports reliably.
 * Renders nothing at all when neither is configured, rather than an empty header row.
 */
function buildHeader(logoDataUrl: string | null, t1Text: string | null): string {
  if (!logoDataUrl && !t1Text) return "";
  const logoCell = logoDataUrl ? `<img src="${logoDataUrl}" alt="" style="max-height: 60px; max-width: 220px;">` : "";
  // escapeHtml first (untrusted admin input), then turn line breaks into <br> — mail clients don't
  // reliably honor CSS white-space: pre-line, but <br> works everywhere.
  const t1Cell = t1Text ? escapeHtml(t1Text).replace(/\n/g, "<br>") : "";
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom: 20px;">
      <tr>
        <td align="left" valign="middle">${logoCell}</td>
        <td align="right" valign="middle" style="font-size: 0.9rem; color: #555555;">${t1Cell}</td>
      </tr>
    </table>`;
}

const ELU_ROLE_LABEL: Record<MailingElu["role"], string> = { TITULAIRE: "Titulaire", SUPPLEANT: "Suppléant(e)" };

/** The union's élus for the recipient's own commission (CCMA/CCMI) — filtered by the caller. */
function buildElusFooter(commission: MailingContext["commission"], elus: MailingElu[]): string {
  if (elus.length === 0) return "";
  const items = elus
    .map((e) => {
      const contact = [e.telephone, e.email].filter((v): v is string => !!v).map(escapeHtml).join(" — ");
      return `<li>${ELU_ROLE_LABEL[e.role]} : ${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}${contact ? ` (${contact})` : ""}</li>`;
    })
    .join("");
  const label = commission ? `Vos élus ${escapeHtml(commission)}` : "Vos élus";
  return `<p style="margin-top: 24px; margin-bottom: 4px;"><strong>${label} :</strong></p><ul style="margin-top: 0;">${items}</ul>`;
}

/** Only shown for a non-adhérent (see MailingContext.isAdherent) — they never explicitly signed up
 * with the union, unlike an adhérent who chose to be a member. */
function buildUnsubscribeLink(isAdherent: boolean): string {
  if (isAdherent) return "";
  const mailto = `mailto:spelc.cotedazur@gmail.com?subject=${encodeURIComponent("se désabonner")}`;
  return `<p style="font-size: 0.8rem; margin-bottom: 8px;"><a href="${mailto}">Se désabonner</a></p>`;
}

function buildSocialLinks(links: MailingSocialLink[]): string {
  if (links.length === 0) return "";
  const items = links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(" · ");
  return `<p style="font-size: 0.8rem;">${items}</p>`;
}

export function buildPromotionEmail(ctx: MailingContext): { subject: string; html: string } {
  const dateFr = formatDateFr(ctx.dateProchainePromotion);
  const civiliteLabel = civilitePrefix(ctx.civilite);
  const nom = escapeHtml(ctx.nom);
  const prenom = escapeHtml(ctx.prenom);
  const grade = escapeHtml(ctx.grade);
  const echelonDepart = escapeHtml(ctx.echelonDepart);
  const echelonSuivant = escapeHtml(ctx.echelonSuivant);
  const salutation = civiliteLabel ? `${civiliteLabel} ${nom},` : `${prenom} ${nom},`;

  const subject = `Spelc — Votre changement d'échelon (${ctx.anneeScolaire})`;

  const promotionParagraph = dateFr
    ? `<p>D'après les informations transmises par le rectorat, vous passerez de l'échelon <strong>${echelonDepart}</strong> à
       l'échelon <strong>${echelonSuivant}</strong> (indice ${ctx.indiceActuel} → ${ctx.futurIndice}) à compter du
       <strong>${dateFr}</strong>.</p>`
    : `<p>D'après les informations transmises par le rectorat, vous êtes actuellement à l'échelon
       <strong>${echelonDepart}</strong> (indice ${ctx.indiceActuel}), qui est le sommet de votre grille — aucun changement
       d'échelon n'est à prévoir pour l'instant.</p>`;

  const gainParagraph =
    ctx.gainSalaireBrut > 0
      ? `<p>Ce changement représente un gain mensuel estimé de <strong>${ctx.gainSalaireBrut} € brut</strong>
         (soit environ <strong>${ctx.gainSalaireNet} € net</strong>).</p>`
      : "";

  const header = buildHeader(ctx.logoDataUrl, ctx.t1Text);
  const elusFooter = buildElusFooter(ctx.commission, ctx.elus);
  const unsubscribeLink = buildUnsubscribeLink(ctx.isAdherent);
  const socialLinks = buildSocialLinks(ctx.socialLinks);

  const html = `
    ${header}
    <p>${salutation}</p>
    <p>Le Spelc a examiné votre situation pour la campagne <strong>${ctx.anneeScolaire}</strong> (grade : ${grade}).</p>
    ${promotionParagraph}
    ${gainParagraph}
    <p>Ces éléments sont fournis à titre indicatif et calculés à partir des données du rectorat ; ils ne remplacent pas votre
    bulletin de salaire officiel.</p>
    <p>Bien cordialement,<br>Le Spelc</p>
    ${elusFooter}
    ${unsubscribeLink}
    ${socialLinks}
  `.trim();

  return { subject, html };
}
