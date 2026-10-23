import { formatPrenom, formatEchelonLabel } from "@spelc/domain";

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
  /** Lien de désabonnement déjà construit par l'appelant (routes/mailing.ts) — null pour un
   * adhérent (jamais de lien) ou quand aucune adresse n'est connue (rien à désabonner). Voir
   * buildUnsubscribeLink ci-dessous. */
  unsubscribeUrl: string | null;
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

/**
 * Converts one rendered email's HTML back to readable plain text, for the "exporter en texte"
 * mailing feature (a lighter, faster alternative to the PDF export — no Chromium render at all —
 * and handy for diffing a campagne's letters against another source, as done manually several
 * times this session by extracting text from a PDF with pdftotext/pypdf). Not a general-purpose
 * HTML-to-text renderer: just enough to undo exactly what this module's own templates produce
 * (headings/paragraphs, <br>, <table> rows for the élus list, <a href>, <strong>/<em>).
 */
export function htmlToPlainText(html: string): string {
  const withLinksExpanded = html.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label} (${href})`);

  // A real line break (NUL, never a byte that occurs in rendered text) is kept distinct from this
  // source's own incidental whitespace — the multi-line template literals in this file wrap their
  // HTML across several indented lines purely for readability in the source, which otherwise
  // reads back as mid-sentence line breaks once the tags are stripped (e.g. "vous passerez de
  // l'échelon 5 à\nl'échelon 6" instead of one sentence).
  // Neither marker is whitespace, so both survive the \s+ collapse below untouched — a real tab
  // inserted directly for a <td>/<th> would just get collapsed away as "incidental" whitespace
  // along with it.
  const LINE_BREAK = "\u0000";
  const CELL_SEP = "\u0001";
  const text = withLinksExpanded
    .replace(/<br\s*\/?>/gi, LINE_BREAK)
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, LINE_BREAK)
    .replace(/<th\b[^>]*>/gi, CELL_SEP)
    .replace(/<td\b[^>]*>/gi, CELL_SEP)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " "); // collapse all real whitespace (incl. the source's own line wrapping) to single spaces

  return text
    .split(LINE_BREAK)
    .map((line) => line.replaceAll(CELL_SEP, "\t").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatDateFr(iso: string | null): string | null {
  if (!iso) return null;
  // "2-digit" day (zero-padded, "01 septembre 2024") — confirmed against the real Word mail-merge
  // output (Lettre_Modele_CCMA_25-03-2026.docx's date picture switch always pads the day; a real
  // sent letter shows "Au 01 septembre 2024 vous aviez un report..."), not plain "numeric" which
  // would instead render "1 septembre 2024".
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * "Cher adhérent,"/"Chère adhérente," (or "collègue" for a non-adhérent) based on the resolved
 * civilité, falling back to the epicène "Cher(e) ...(e)," form when the civilité couldn't be
 * resolved — immediately followed by the recipient's own "<Prénom> <NOM>" line (prénom in proper
 * case, see formatPrenom; NOM kept all-caps, as every source gives it). Replaces the old plain
 * "<Civilité> <NOM>," salutation.
 */
export function buildGreeting(civilite: string | null, isAdherent: boolean, prenom: string, nom: string): string {
  const c = civilite?.trim().toLowerCase() ?? null;
  const roleM = isAdherent ? "adhérent" : "collègue";
  const roleF = isAdherent ? "adhérente" : "collègue";
  const roleEpicene = isAdherent ? "adhérent(e)" : "collègue";
  const greeting = c?.startsWith("mme") ? `Chère ${roleF},` : c?.startsWith("m") ? `Cher ${roleM},` : `Cher(e) ${roleEpicene},`;
  return `<p>${greeting}<br>${escapeHtml(formatPrenom(prenom))} ${escapeHtml(nom)}</p>`;
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

/** Annonce du renouvellement des élus (élections professionnelles du 3 au 10 décembre 2026),
 * affichée juste avant la liste des élus elle-même — campagne ponctuelle (dates et contenu en dur,
 * pas de champ Paramètres dédié), mais le mot "CCMA"/"CCMI" s'adapte à la commission du
 * destinataire comme partout ailleurs dans ce modèle. Rendue même si la commission est inconnue
 * (texte générique "la commission") ou si aucun élu n'est encore saisi — indépendante de
 * buildElusFooter, qui ne gère que le tableau des élus lui-même. */
export function buildElusElectionNotice(commission: MailingContext["commission"]): string {
  const label = commission ? escapeHtml(commission) : "commission";
  return `
    <p>Vos représentants à la ${label} seront renouvelés à l'issue des élections du 3 au 10 décembre 2026.<br>
    Continuez de nous faire confiance en votant pour les candidats Spelc !<br>
    Vous pouvez dès à présent, vérifier votre statut d'électeur et avoir accès à nos tutos en cliquant ici :</p>
    <p style="text-align: center; margin: 16px 0;">
      <a href="https://electionsprofessionnelles.spelc.fr/" style="display: inline-block; background-color: #1a56db; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: bold;">Nos tutos</a>
    </p>`;
}

/** The union's élus for the recipient's own commission (CCMA/CCMI) — filtered and ordered
 * (titulaires then suppléants, puis l'ordre manuel de chaque groupe — voir loadElusByCommission
 * dans routes/mailing.ts) by the caller. One élu per row, name then téléphone/e-mail on a second
 * line — the titulaire/suppléant distinction is deliberately not shown AS TEXT (confirmed by the
 * union: the recipient just needs someone to call, not which seat they hold) ; les deux groupes
 * sont néanmoins affichés dans deux colonnes séparées (titulaires à gauche, suppléant(e)s à
 * droite, sans libellé) — demande explicite de l'union (2026-10-23) pour que chaque courrier
 * tienne sur une seule page de PDF.
 *
 * A 3-column table (name/téléphone/e-mail side by side) is unreadable on a phone — a narrow mail
 * client squeezes the téléphone column down to a handful of characters, wrapping a single mobile
 * number across up to 4 lines (confirmed by the union on a real CCMI letter). One column per élu,
 * with téléphone and e-mail together on their own line underneath the name, lets both wrap as
 * normal flowing text instead of being trapped in an undersized column. */
export function buildElusFooter(commission: MailingContext["commission"], elus: MailingElu[]): string {
  if (elus.length === 0) return "";

  function rowsFor(group: MailingElu[]): string {
    return group
      .map((e) => {
        const contact = [e.telephone, e.email].filter((v): v is string => Boolean(v)).map(escapeHtml).join(" · ");
        return `<tr>
          <td style="padding: 6px 0; border-bottom: 1px solid #eeeeee;">
            <strong>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</strong>${contact ? `<br>${contact}` : ""}
          </td>
        </tr>`;
      })
      .join("");
  }

  function columnTable(group: MailingElu[]): string {
    if (group.length === 0) return "";
    return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse; font-size: 0.9rem;">${rowsFor(group)}</table>`;
  }

  const titulaires = elus.filter((e) => e.role === "TITULAIRE");
  const suppleants = elus.filter((e) => e.role === "SUPPLEANT");
  const label = commission ? `Vos élu(e)s ${escapeHtml(commission)}` : "Vos élu(e)s";

  // Deux colonnes seulement quand les deux groupes existent — sinon une seule colonne pleine
  // largeur, pour ne pas laisser un vide à côté (ex. aucun suppléant encore saisi).
  const body =
    titulaires.length > 0 && suppleants.length > 0
      ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;">
          <tr>
            <td width="50%" valign="top" style="padding-right: 12px;">${columnTable(titulaires)}</td>
            <td width="50%" valign="top" style="padding-left: 12px;">${columnTable(suppleants)}</td>
          </tr>
        </table>`
      : columnTable(titulaires.length > 0 ? titulaires : suppleants);

  return `
    <p style="margin-top: 24px; margin-bottom: 4px;"><strong>${label} :</strong></p>
    ${body}`;
}

/** Rendu uniquement quand l'appelant a construit un lien (jamais pour un adhérent — voir
 * routes/mailing.ts) — un clic désabonne définitivement cette adresse/ce nom des notifications de
 * promotion, sans confirmation supplémentaire requise par e-mail (voir
 * routes/mailingUnsubscribe.ts, qui affiche sa propre page de confirmation avant d'agir). */
export function buildUnsubscribeLink(unsubscribeUrl: string | null): string {
  if (!unsubscribeUrl) return "";
  return `<p style="font-size: 0.8rem; margin-bottom: 8px;"><a href="${escapeHtml(unsubscribeUrl)}">Se désabonner de ces notifications</a></p>`;
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
  const grade = escapeHtml(ctx.grade);
  const echelonDepart = escapeHtml(formatEchelonLabel(ctx.echelonDepart));
  const echelonSuivant = escapeHtml(formatEchelonLabel(ctx.echelonSuivant));
  const greeting = buildGreeting(ctx.civilite, ctx.isAdherent, ctx.prenom, ctx.nom);

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
  const electionNotice = buildElusElectionNotice(ctx.commission);
  const elusFooter = buildElusFooter(ctx.commission, ctx.elus);
  const unsubscribeLink = buildUnsubscribeLink(ctx.unsubscribeUrl);
  const socialLinks = buildSocialLinks(ctx.socialLinks);

  const html = `
    ${header}
    ${greeting}
    <p>Le Spelc a examiné votre situation pour la campagne <strong>${ctx.anneeScolaire}</strong> (grade : ${grade}).</p>
    ${promotionParagraph}
    ${gainParagraph}
    <p>Ces éléments sont fournis à titre indicatif et calculés à partir des données du rectorat ; ils ne remplacent pas votre
    bulletin de salaire officiel.</p>
    <p>Bien cordialement,<br>Le Spelc</p>
    ${electionNotice}
    ${elusFooter}
    ${unsubscribeLink}
    ${socialLinks}
  `.trim();

  return { subject, html };
}
