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

  const html = `
    <p>${salutation}</p>
    <p>Le Spelc a examiné votre situation pour la campagne <strong>${ctx.anneeScolaire}</strong> (grade : ${grade}).</p>
    ${promotionParagraph}
    ${gainParagraph}
    <p>Ces éléments sont fournis à titre indicatif et calculés à partir des données du rectorat ; ils ne remplacent pas votre
    bulletin de salaire officiel.</p>
    <p>Bien cordialement,<br>Le Spelc</p>
  `.trim();

  return { subject, html };
}
