import { describe, expect, it } from "vitest";
import { buildPromotionEmail } from "../src/mailing/template.js";

describe("buildPromotionEmail", () => {
  it("renders the promotion date and gain when a next échelon date is known", () => {
    const { subject, html } = buildPromotionEmail({
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
    });

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
      anneeScolaire: "2024-2025",
    });

    expect(html).toContain("sommet de votre grille");
    expect(html).not.toContain("gain mensuel estimé");
  });

  it("falls back to prénom+nom when no civilité is known", () => {
    const { html } = buildPromotionEmail({
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
      anneeScolaire: "2024-2025",
    });

    expect(html).toContain("Marie DUPONT,");
  });

  it("escapes HTML-like content coming from imported nom/prénom/grade fields", () => {
    const { html } = buildPromotionEmail({
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
      anneeScolaire: "2024-2025",
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});
