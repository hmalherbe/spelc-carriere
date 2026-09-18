import { describe, expect, it } from "vitest";
import { buildCcmaModelEmail, CcmaModelUnavailableError, type CcmaModelContext } from "../src/mailing/ccmaModelTemplate.js";

// Base fixture matching the real letter used to reverse-engineer this template
// (Lettre_Modele_CCMA_25-03-2026.docx, recipient Elise MORIN): échelon 4 -> 5, passage normal PPCR
// (Bonification = "ANCIENNETE"), no report d'ancienneté, no BA candidacy at all this cycle, landing
// on échelon 5 (not a BA window) so no accelerated future-promotion variant either.
const BASE: CcmaModelContext = {
  civilite: null,
  prenom: "Elise",
  nom: "MORIN",
  email: "elise.m83@hotmail.fr",
  isAdherent: true,
  commission: "CCMA",
  elus: [],
  t1Text: null,
  logoDataUrl: null,
  socialLinks: [],
  dateCcma: "2026-03-25",
  grade: "AGREGE",
  echelonDepart: "4",
  echelonSuivant: "5",
  gainSalaireNet: 140,
  dateAccesEchelonActuel: "2025-09-01",
  dateEffetCcm: "2026-04-07",
  typePromotion: "AN",
  dureeRestanteEncoded: null,
  bonification: "ANCIENNETE",
  dateEligibiliteBA: null,
  pourcentagePromusBa: null,
  bareme: null,
  ancienneteGrade: null,
  ancienneteEchelon: null,
  dernierPromu: null,
  dateFuturePromotion: "2028-10-07",
  dateFuturePromotionSiBA: null,
};

describe("buildCcmaModelEmail", () => {
  it("refuses to render for a CCMI recipient (composition text not confirmed)", () => {
    expect(() => buildCcmaModelEmail({ ...BASE, commission: "CCMI" })).toThrow(CcmaModelUnavailableError);
  });

  it("renders the campaign title, salutation and current-échelon paragraph", () => {
    const { subject, html } = buildCcmaModelEmail(BASE);
    expect(subject).toBe("Spelc Côte d'Azur - CCMA du 25 mars 2026 : avancements");
    expect(html).toContain("CCMA du 25 mars 2026");
    expect(html).toContain("Elise MORIN,");
    expect(html).toContain("elise.m83@hotmail.fr");
    expect(html).toContain("Vous étiez à l'échelon <strong>4</strong> de l'échelle de rémunération : AGREGE.");
  });

  it("shows the normal-PPCR passage paragraph when bonification = ANCIENNETE, and nothing BA-related", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).toContain("prévu par les durées du PPCR est acté au 7 avril 2026");
    expect(html).not.toContain("bonification d'ancienneté d'un an");
    expect(html).not.toContain("Votre barème");
  });

  it("shows the gain and next-promotion paragraphs (no BA window at échelon 5)", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).toContain("140 € nets");
    expect(html).toContain("régularisation financière devrait intervenir au plus tôt en avril 2026");
    expect(html).toContain("Votre prochaine promotion dans ce grade est prévue le : 7 octobre 2028.");
    expect(html).not.toContain("l'accélération de carrière d'un an du PPCR");
  });

  it("shows the report d'ancienneté paragraph when typePromotion is RE", () => {
    const withReport = buildCcmaModelEmail({
      ...BASE,
      typePromotion: "RE",
      dureeRestanteEncoded: "01a01m21j",
    }).html;
    expect(withReport).toContain("vous aviez un report d'ancienneté de 1 an 1 mois 21 jours");

    expect(buildCcmaModelEmail(BASE).html).not.toContain("report d'ancienneté");
  });

  it("also shows the report d'ancienneté paragraph when typePromotion is CL (reclassement) — real case, Elise MORIN", () => {
    const html = buildCcmaModelEmail({
      ...BASE,
      typePromotion: "CL",
      dureeRestanteEncoded: "01a04m24j",
    }).html;
    expect(html).toContain("vous aviez un report d'ancienneté de 1 an 4 mois 24 jours");
  });

  it("omits the report d'ancienneté paragraph when typePromotion is RE/CL but the duration is literally zero (real case)", () => {
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "RE", dureeRestanteEncoded: "00a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "CL", dureeRestanteEncoded: "00a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
  });

  it("shows the accelerated future-promotion variant when landing on a BA window (échelon 6 or 8)", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "6",
      dateFuturePromotion: "2029-11-18",
      dateFuturePromotionSiBA: "2028-11-18",
    });
    expect(html).toContain("soit le 18 novembre 2028 avec l'accélération de carrière d'un an du PPCR, ou à défaut le 18 novembre 2029");
  });

  it("BA granted: shows the acceptance paragraph and omits the passage-normal paragraph", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "9",
      bonification: "BONIFICATION",
      dateEligibiliteBA: "2026-03-01",
      bareme: 3,
      ancienneteGrade: 2,
      ancienneteEchelon: 2,
      dernierPromu: { bareme: 2, ancienneteGrade: 5, ancienneteEchelon: 1 },
    });
    expect(html).toContain("celle-ci a été acceptée");
    expect(html).not.toContain("prévu par les durées du PPCR est acté");
    expect(html).toContain("Votre barème");
  });

  it("BA not granted, some promus in the group: shows the computed percentage and comparison, no gain paragraph", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "9",
      bonification: "NON_PROMU",
      gainSalaireNet: 0,
      pourcentagePromusBa: 30,
      bareme: 2,
      ancienneteGrade: 2,
      ancienneteEchelon: 2,
      dernierPromu: { bareme: 2, ancienneteGrade: 2, ancienneteEchelon: 2 },
    });
    expect(html).toContain("seuls 30 % des promouvables");
    expect(html).not.toContain("nets par mois");
    // Tied on barème, ancienneté grade AND ancienneté échelon -> all three comparison levels show.
    expect(html).toContain("Votre ancienneté dans le grade");
    expect(html).toContain("Votre ancienneté dans l'échelon");
  });

  it("BA not granted, nobody promoted in the group: shows the 'aucun promu' message, no percentage", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      bonification: "NON_PROMU",
      gainSalaireNet: 0,
      pourcentagePromusBa: 0,
    });
    expect(html).toContain("aucun promu à la bonification d'ancienneté");
    expect(html).not.toContain("des promouvables ont obtenu");
  });

  it("comparison stops at barème when the two barèmes differ", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      bonification: "NON_PROMU",
      gainSalaireNet: 0,
      pourcentagePromusBa: 30,
      bareme: 1,
      ancienneteGrade: 2,
      ancienneteEchelon: 2,
      dernierPromu: { bareme: 3, ancienneteGrade: 5, ancienneteEchelon: 1 },
    });
    expect(html).toContain("Votre barème");
    expect(html).not.toContain("Votre ancienneté dans le grade");
  });

  it("escapes untrusted fields (nom/prénom/grade)", () => {
    const { html } = buildCcmaModelEmail({ ...BASE, nom: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reuses the shared header/footer (logo, t1, élus, unsubscribe, social links)", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      isAdherent: false,
      logoDataUrl: "data:image/png;base64,AAAA",
      t1Text: "Section Côte d'Azur",
      elus: [{ role: "TITULAIRE", prenom: "Sophie", nom: "CACHET", telephone: "0682341995", email: null }],
      socialLinks: [{ label: "Facebook", url: "https://facebook.com/x" }],
    });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("Section Côte d&#39;Azur");
    expect(html).toContain("Sophie CACHET");
    expect(html).toContain("Se désabonner");
    expect(html).toContain("Facebook");
  });
});
