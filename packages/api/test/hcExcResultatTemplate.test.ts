import { describe, expect, it } from "vitest";
import { buildHcExcResultatEmail, type HcExcResultatContext } from "../src/mailing/hcExcResultatTemplate.js";

// Fixture reproduisant un cas réel (CCMA HC du 12 juin 2025, échelon 9, grade PLP, non promu, sans
// avis/points/barème importés) trouvé en comparant un mailing réel au classeur Excel de l'ancienne
// application le 2026-11-02 — nom et adresse fictifs, seuls les champs pertinents sont repris.
const BASE: HcExcResultatContext = {
  civilite: null,
  prenom: "Test",
  nom: "DUPONT",
  email: "test.dupont@example.org",
  isAdherent: true,
  unsubscribeUrl: null,
  commission: "CCMA",
  elus: [],
  t1Text: null,
  logoDataUrl: null,
  socialLinks: [],
  processus: "HC",
  dateCcma: "2025-06-12",
  dateEffet: null,
  grade: "PLP",
  estAgrege: false,
  rang: 23,
  nombrePromus: 9,
  appreciationRecteur: null,
  pointsRecteur: null,
  promu: false,
  pointsAnciennete: null,
  totalBareme: null,
};

describe("buildHcExcResultatEmail", () => {
  it("dateEffet promotion is the 1er septembre of the school year AFTER the one evaluated, not periodeDebut's own year", () => {
    // Bug réel trouvé le 2026-11-02 : les lettres "promu(e)" annonçaient le 01/09/2024
    // (campagne.periodeDebut, année scolaire ÉVALUÉE) au lieu du 01/09/2025 attendu (periodeFin +
    // 1 jour) — une date antérieure à la CCMA elle-même (12 juin 2025).
    const { html } = buildHcExcResultatEmail({ ...BASE, promu: true, dateEffet: "2025-09-01" });
    expect(html).toContain("Vous êtes promu(e) à la hors classe au 01 septembre 2025.");
    expect(html).not.toContain("2024");
  });

  it('says "à la hors classe" (with article), not "à hors classe"', () => {
    const promuHtml = buildHcExcResultatEmail({ ...BASE, promu: true, dateEffet: "2025-09-01" }).html;
    expect(promuHtml).toContain("promu(e) à la hors classe au");

    const nonPromuHtml = buildHcExcResultatEmail({ ...BASE, promu: false }).html;
    expect(nonPromuHtml).toContain("Vous n'avez pas été promu(e) à la hors classe.");
  });

  it("drops the dangling \"cette appréciation sera prise en compte\" sentence when no appréciation is shown at all", () => {
    // Cas réel trouvé le 2026-11-02 (grade PLP, échelon 9) : appreciationRecteur/pointsRecteur
    // manquants, mais la phrase de suivi s'affichait tout de même, sans rien à quoi se rattacher.
    const { html } = buildHcExcResultatEmail(BASE);
    expect(html).not.toContain("Cette appréciation sera prise en compte");
    expect(html).not.toContain("L'appréciation du Recteur est «");
  });

  it("keeps the dangling-sentence guard sentence when an appréciation IS shown and the candidate isn't promoted", () => {
    const { html } = buildHcExcResultatEmail({ ...BASE, appreciationRecteur: "Excellent", pointsRecteur: 145 });
    expect(html).toContain("L'appréciation du Recteur est « Excellent », ce qui correspond à 145 points*.");
    expect(html).toContain("Cette appréciation sera prise en compte pour la prochaine campagne de promotion.");
  });

  it("still shows rang/contingent for a non-Agrégé", () => {
    const { html } = buildHcExcResultatEmail(BASE);
    expect(html).toContain("Votre rang est : <strong>23</strong>.");
    expect(html).toContain("Le nombre de promus pour l'échelle de rémunération PLP est : <strong>9</strong>.");
  });

  it("hides rang/contingent for an Agrégé", () => {
    const { html } = buildHcExcResultatEmail({ ...BASE, grade: "AGREGE", estAgrege: true, rang: 1, nombrePromus: 7 });
    expect(html).not.toContain("Votre rang est");
    expect(html).not.toContain("nombre de promus");
  });
});
