import { describe, expect, it } from "vitest";
import { buildPromotionEmail, type MailingContext } from "../src/mailing/template.js";

const BASE: MailingContext = {
  civilite: "Mme",
  prenom: "Irene",
  nom: "ABOUD",
  grade: "CERTIFIE HC",
  echelonDepart: "5",
  echelonSuivant: "6",
  indiceActuel: 768,
  futurIndice: 811,
  gainSalaireBrut: 211,
  gainSalaireNet: 163,
  dateProchainePromotion: "2025-03-01T00:00:00.000Z",
  anneeScolaire: "2024-2025",
  isAdherent: true,
  commission: null,
  elus: [],
  t1Text: null,
  logoDataUrl: null,
  socialLinks: [],
};

describe("buildPromotionEmail", () => {
  it("renders the promotion date and gain when a next échelon date is known", () => {
    const { subject, html } = buildPromotionEmail(BASE);

    expect(subject).toContain("2024-2025");
    expect(html).toContain("Madame ABOUD");
    expect(html).toContain("échelon <strong>5</strong>");
    expect(html).toContain("échelon <strong>6</strong>");
    expect(html).toContain("211 €");
    expect(html).toContain("163 €");
    expect(html).toContain("1 mars 2025");
  });

  it("renders a ceiling-échelon message and omits the gain paragraph when there is no next promotion", () => {
    const { html } = buildPromotionEmail({
      ...BASE,
      civilite: "M.",
      prenom: "Bruno",
      nom: "ACKERMANN",
      grade: "CERTIFIE",
      echelonDepart: "11",
      echelonSuivant: "11",
      indiceActuel: 830,
      futurIndice: 830,
      gainSalaireBrut: 0,
      gainSalaireNet: 0,
      dateProchainePromotion: null,
    });

    expect(html).toContain("sommet de votre grille");
    expect(html).not.toContain("gain mensuel estimé");
  });

  it("falls back to prénom+nom when no civilité is known", () => {
    const { html } = buildPromotionEmail({
      ...BASE,
      civilite: null,
      prenom: "Marie",
      nom: "DUPONT",
      grade: "CERTIFIE",
      echelonDepart: "3",
      echelonSuivant: "4",
      indiceActuel: 450,
      futurIndice: 470,
      gainSalaireBrut: 100,
      gainSalaireNet: 77,
      dateProchainePromotion: "2025-01-01T00:00:00.000Z",
    });

    expect(html).toContain("Marie DUPONT,");
  });

  it("escapes HTML-like content coming from imported nom/prénom/grade fields", () => {
    const { html } = buildPromotionEmail({
      ...BASE,
      civilite: null,
      prenom: "<img src=x onerror=alert(1)>",
      nom: "</p><script>alert(1)</script>",
      grade: "CERTIFIE<script>",
      echelonDepart: "3",
      echelonSuivant: "4",
      indiceActuel: 450,
      futurIndice: 470,
      gainSalaireBrut: 100,
      gainSalaireNet: 77,
      dateProchainePromotion: "2025-01-01T00:00:00.000Z",
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders no header at all when neither logo nor t1 text is configured", () => {
    const { html } = buildPromotionEmail(BASE);
    expect(html).not.toContain("<table");
  });

  it("renders the logo and t1 text side by side when both are configured", () => {
    const { html } = buildPromotionEmail({ ...BASE, logoDataUrl: "data:image/png;base64,AAAA", t1Text: "Section Côte d'Azur" });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("Section Côte d&#39;Azur");
  });

  it("escapes the t1 text", () => {
    const { html } = buildPromotionEmail({ ...BASE, t1Text: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("lists the recipient's own commission's élus, titulaires and suppléants, with their contact info", () => {
    const { html } = buildPromotionEmail({
      ...BASE,
      commission: "CCMA",
      elus: [
        { role: "TITULAIRE", prenom: "Julien", nom: "MARTIN", telephone: "06 00 00 00 00", email: "julien@spelc.example" },
        { role: "SUPPLEANT", prenom: "Sophie", nom: "DURAND", telephone: null, email: null },
      ],
    });
    expect(html).toContain("Vos élus CCMA");
    expect(html).toContain("Titulaire : Julien MARTIN (06 00 00 00 00 — julien@spelc.example)");
    expect(html).toContain("Suppléant(e) : Sophie DURAND");
  });

  it("renders no élus section when the list is empty", () => {
    const { html } = buildPromotionEmail({ ...BASE, commission: "CCMI", elus: [] });
    expect(html).not.toContain("Vos élus");
  });

  it("shows the unsubscribe mailto link only for a non-adhérent", () => {
    const { html: adherentHtml } = buildPromotionEmail({ ...BASE, isAdherent: true });
    expect(adherentHtml).not.toContain("Se désabonner");

    const { html: nonAdherentHtml } = buildPromotionEmail({ ...BASE, isAdherent: false });
    expect(nonAdherentHtml).toContain("Se désabonner");
    expect(nonAdherentHtml).toContain("mailto:spelc.cotedazur@gmail.com?subject=se%20d%C3%A9sabonner");
  });

  it("renders social links at the end of the letter", () => {
    const { html } = buildPromotionEmail({
      ...BASE,
      socialLinks: [
        { label: "Facebook", url: "https://facebook.com/spelc" },
        { label: "Twitter", url: "https://twitter.com/spelc" },
      ],
    });
    expect(html).toContain('<a href="https://facebook.com/spelc">Facebook</a>');
    expect(html).toContain('<a href="https://twitter.com/spelc">Twitter</a>');
  });
});
