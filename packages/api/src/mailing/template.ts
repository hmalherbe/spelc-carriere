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
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateFr(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function civilitePrefix(civilite: string | null): string {
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
export function buildHeader(logoDataUrl: string | null, t1Text: string | null): string {
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
export function buildElusFooter(commission: MailingContext["commission"], elus: MailingElu[]): string {
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
export function buildUnsubscribeLink(isAdherent: boolean): string {
  if (isAdherent) return "";
  const mailto = `mailto:spelc.cotedazur@gmail.com?subject=${encodeURIComponent("se désabonner")}`;
  return `<p style="font-size: 0.8rem; margin-bottom: 8px;"><a href="${mailto}">Se désabonner</a></p>`;
}

/**
 * Small, self-drawn (not hotlinked — see below) 20x20 SVG badges, one per recognized network, kept
 * intentionally simple (flat shapes + a text glyph) rather than exact brand artwork: reproducing a
 * real logo's path data from memory risks looking subtly wrong, and a network's official icon
 * files aren't something this app has a way to host (no blob storage beyond the single admin-
 * uploaded org logo, see buildHeader's logoDataUrl) or fetch at send time without depending on a
 * third-party CDN staying up — brittle for something as consequential as a promotion notification.
 */
const SOCIAL_ICON_SVG: Record<"facebook" | "instagram" | "twitter" | "linkedin" | "youtube" | "tiktok" | "generic", string> = {
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#1877F2"/><text x="10" y="14.5" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">f</text></svg>`,
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="5" fill="#C13584"/><rect x="5.5" y="5.5" width="9" height="9" rx="3" fill="none" stroke="#ffffff" stroke-width="1.6"/><circle cx="14.3" cy="5.7" r="1" fill="#ffffff"/></svg>`,
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#000000"/><text x="10" y="14.5" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle">X</text></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#0A66C2"/><text x="10" y="14.5" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle">in</text></svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="0" y="2" width="20" height="16" rx="5" fill="#FF0000"/><polygon points="8,6.5 8,13.5 14,10" fill="#ffffff"/></svg>`,
  tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#000000"/><text x="10" y="14.5" font-family="Arial, sans-serif" font-size="11" fill="#ffffff" text-anchor="middle">&#9834;</text></svg>`,
  generic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#6B7280"/><path d="M8.2 11.8a2.4 2.4 0 0 1 0-3.4l1.6-1.6a2.4 2.4 0 0 1 3.4 3.4l-.9.9" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M11.8 8.2a2.4 2.4 0 0 1 0 3.4l-1.6 1.6a2.4 2.4 0 0 1-3.4-3.4l.9-.9" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`,
};

/** Identifies the network from the link's URL (not its free-text label, which an admin could spell
 * any way) so the right badge is picked automatically — falls back to a generic "link" badge for
 * anything not recognized (a personal site, a blog...) rather than guessing or showing nothing. */
function detectSocialNetwork(url: string): keyof typeof SOCIAL_ICON_SVG {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  if (host.includes("facebook.com") || host.includes("fb.com")) return "facebook";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("tiktok.com")) return "tiktok";
  return "generic";
}

/** data: URI, not a hosted file — works inline in the HTML with no external request at all, so
 * nothing to go down/be blocked by a recipient's image-loading settings differently than any other
 * part of the email. */
function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function buildSocialLinks(links: MailingSocialLink[]): string {
  if (links.length === 0) return "";
  const items = links
    .map((l) => {
      const icon = `<img src="${svgToDataUri(SOCIAL_ICON_SVG[detectSocialNetwork(l.url)])}" width="18" height="18" alt="" style="vertical-align: middle; margin-right: 6px; border: 0;">`;
      return `<a href="${escapeHtml(l.url)}" style="text-decoration: none; color: inherit; display: inline-block; margin-right: 16px;">${icon}${escapeHtml(l.label)}</a>`;
    })
    .join("");
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
