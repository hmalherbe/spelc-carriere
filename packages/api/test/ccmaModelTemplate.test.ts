import { describe, expect, it } from "vitest";
import { buildCcmaModelEmail, type CcmaModelContext } from "../src/mailing/ccmaModelTemplate.js";

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
  unsubscribeUrl: null,
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
  ancienneteAReporterManuelle: null,
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
  it("renders for CCMI too, dropping the CCMA-only seat-count sentence (confirmed by the union: no CCMI figure to show)", () => {
    const { subject, html } = buildCcmaModelEmail({ ...BASE, commission: "CCMI" });
    expect(subject).toBe("Spelc Côte d'Azur - CCMI du 25 mars 2026 : avancements");
    expect(html).toContain("CCMI du 25 mars 2026");
    expect(html).toContain("La CCMI de ce jour a examiné votre situation d'avancement d'échelon. Le Spelc s'est assuré");
    expect(html).not.toContain("syndicat majoritaire");
    expect(html).not.toContain("sièges");
  });

  it("keeps the CCMA seat-count sentence unchanged", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).toContain(
      "La CCMA de ce jour a examiné votre situation d'avancement d'échelon. Le Spelc, syndicat majoritaire et représenté avec 3 sièges sur 5, s'est assuré",
    );
  });

  it("renders the campaign title, greeting and current-échelon paragraph", () => {
    const { subject, html } = buildCcmaModelEmail(BASE);
    expect(subject).toBe("Spelc Côte d'Azur - CCMA du 25 mars 2026 : avancements");
    expect(html).toContain("CCMA du 25 mars 2026");
    expect(html).toContain("Cher(e) adhérent(e),");
    expect(html).toContain("Elise MORIN");
    expect(html).toContain("elise.m83@hotmail.fr");
    expect(html).toContain("Vous étiez à l'échelon <strong>4</strong> de l'échelle de rémunération : AGREGE.");
  });

  it("greets a known civilité as 'Cher adhérent'/'Chère adhérente', or 'collègue' for a non-adhérent", () => {
    expect(buildCcmaModelEmail({ ...BASE, civilite: "M" }).html).toContain("Cher adhérent,");
    expect(buildCcmaModelEmail({ ...BASE, civilite: "Mme" }).html).toContain("Chère adhérente,");
    expect(buildCcmaModelEmail({ ...BASE, civilite: "M", isAdherent: false }).html).toContain("Cher collègue,");
    expect(buildCcmaModelEmail({ ...BASE, civilite: "Mme", isAdherent: false }).html).toContain("Chère collègue,");
    expect(buildCcmaModelEmail({ ...BASE, civilite: null, isAdherent: false }).html).toContain("Cher(e) collègue,");
  });

  it("shows the normal-PPCR passage paragraph when bonification = ANCIENNETE, and nothing BA-related", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).toContain("prévu par les durées du PPCR est acté au <strong>07 avril 2026</strong>");
    expect(html).not.toContain("bonification d'ancienneté d'un an");
    expect(html).not.toContain("Votre barème");
  });

  it("shows the gain and next-promotion paragraphs (no BA window at échelon 5)", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).toContain("140 € nets");
    expect(html).toContain("régularisation financière devrait intervenir au plus tôt en avril 2026");
    expect(html).toContain("Votre prochaine promotion dans ce grade est prévue le : <strong>07 octobre 2028</strong>.");
    expect(html).not.toContain("l'accélération de carrière d'un an du PPCR");
  });

  it("shows the gain/régularisation paragraph regardless of the actual gain amount, as long as bonification <> NON_PROMU (real Word template has no condition on the amount)", () => {
    const { html } = buildCcmaModelEmail({ ...BASE, gainSalaireNet: 0 });
    expect(html).toContain("0 € nets");
    expect(html).toContain("régularisation financière devrait intervenir au plus tôt en avril 2026");
  });

  it("announces the CCMA's own month for the régularisation when the promotion's date d'effet falls in an earlier month (report d'ancienneté, reliquat...) — never a month before the CCMA itself", () => {
    const { html } = buildCcmaModelEmail({ ...BASE, dateCcma: "2026-03-25", dateEffetCcm: "2025-11-01" });
    expect(html).toContain("régularisation financière devrait intervenir au plus tôt en mars 2026");
  });

  it("keeps announcing the date d'effet's own month for the régularisation when it falls in the same month as the CCMA, or later", () => {
    expect(buildCcmaModelEmail({ ...BASE, dateCcma: "2026-03-25", dateEffetCcm: "2026-03-02" }).html).toContain(
      "régularisation financière devrait intervenir au plus tôt en mars 2026",
    );
    expect(buildCcmaModelEmail({ ...BASE, dateCcma: "2026-03-25", dateEffetCcm: "2026-09-15" }).html).toContain(
      "régularisation financière devrait intervenir au plus tôt en septembre 2026",
    );
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

  it("omits the report d'ancienneté paragraph when typePromotion is RE/CL/AN but the duration is literally zero (real case)", () => {
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "RE", dureeRestanteEncoded: "00a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "CL", dureeRestanteEncoded: "00a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "AN", dureeRestanteEncoded: "00a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
  });

  it("also shows the report d'ancienneté paragraph when typePromotion is AN (passage normal) — real case, Benjamin BUYSSCHAERT", () => {
    const html = buildCcmaModelEmail({
      ...BASE,
      typePromotion: "AN",
      dureeRestanteEncoded: "00a03m16j",
      dateAccesEchelonActuel: "2024-05-15",
    }).html;
    expect(html).toContain("Au 15 mai 2024 vous aviez un report d'ancienneté de 3 mois 16 jours.");
  });

  it("does NOT show the report d'ancienneté paragraph when typePromotion is BA — no real case justifies it", () => {
    expect(buildCcmaModelEmail({ ...BASE, typePromotion: "BA", dureeRestanteEncoded: "01a00m00j" }).html).not.toContain(
      "report d'ancienneté",
    );
  });

  // Confirmed by the union (2026-10-14): editing "ancienneté à reporter" from the Enseignants page
  // immediately recomputes the announced date, but the "report d'ancienneté" sentence still quoted
  // the rectorat's own raw marker — showing a report figure inconsistent with the date right after
  // it whenever an admin corrected a wrong/missing automatic derivation.
  it("prefers the manual ancienneté-à-reporter correction over the rectorat's raw marker in the report d'ancienneté sentence", () => {
    const html = buildCcmaModelEmail({
      ...BASE,
      typePromotion: "RE",
      dureeRestanteEncoded: "00a11m05j", // the rectorat's own (wrong/incomplete) figure
      ancienneteAReporterManuelle: "01a02m10j", // the admin's correction — must win
    }).html;
    expect(html).toContain("vous aviez un report d'ancienneté de 1 an 2 mois 10 jours");
    expect(html).not.toContain("11 mois 5 jours");
  });

  it("shows the manual correction even when typePromotion is BA or null — the correction is a deliberate override, not gated on the rectorat's own marker", () => {
    expect(
      buildCcmaModelEmail({ ...BASE, typePromotion: "BA", dureeRestanteEncoded: null, ancienneteAReporterManuelle: "00a06m00j" }).html,
    ).toContain("vous aviez un report d'ancienneté de 6 mois");
    expect(
      buildCcmaModelEmail({ ...BASE, typePromotion: null, dureeRestanteEncoded: null, ancienneteAReporterManuelle: "00a06m00j" }).html,
    ).toContain("vous aviez un report d'ancienneté de 6 mois");
  });

  it("omits the report d'ancienneté paragraph when the manual correction is literally zero, even if typePromotion wouldn't otherwise show it", () => {
    expect(
      buildCcmaModelEmail({ ...BASE, typePromotion: "BA", dureeRestanteEncoded: "01a00m00j", ancienneteAReporterManuelle: "00a00m00j" })
        .html,
    ).not.toContain("report d'ancienneté");
  });

  it("shows the accelerated future-promotion variant when landing on a BA window (échelon 6 or 8)", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "6",
      dateFuturePromotion: "2029-11-18",
      dateFuturePromotionSiBA: "2028-11-18",
    });
    expect(html).toContain(
      "soit le <strong>18 novembre 2028</strong> avec l'accélération de carrière d'un an du PPCR, ou à défaut le <strong>18 novembre 2029</strong>",
    );
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
    expect(html).toContain("à la date du <strong>01 mars 2026</strong>.");
    expect(html).not.toContain("prévu par les durées du PPCR est acté");
    expect(html).toContain("Votre barème");
  });

  it("bolds every promotion date shown (per product decision) — the promotion date itself and any future-promotion date, in every variant", () => {
    // Passage normal (no bonification in play) — already bold before this change, kept as a guard.
    expect(buildCcmaModelEmail(BASE).html).toContain("prévu par les durées du PPCR est acté au <strong>07 avril 2026</strong>.");

    // BA non promu: the "la CCMA/CCMI de l'année prochaine actera..." date.
    const nonPromu = buildCcmaModelEmail({
      ...BASE,
      bonification: "NON_PROMU",
      gainSalaireNet: 0,
      pourcentagePromusBa: 30,
      dateEligibiliteBA: "2026-02-05",
      dateEffetCcm: "2027-02-05",
    }).html;
    expect(nonPromu).toContain("à la date du <strong>05 février 2027</strong>.");

    // Future-promotion block, both the plain and the accelerated variants.
    const futureNormal = buildCcmaModelEmail({ ...BASE, dateFuturePromotion: "2028-10-07" }).html;
    expect(futureNormal).toContain("est prévue le : <strong>07 octobre 2028</strong>.");

    const futureAccelerated = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "6",
      dateFuturePromotion: "2029-11-18",
      dateFuturePromotionSiBA: "2028-11-18",
    }).html;
    expect(futureAccelerated).toContain("soit le <strong>18 novembre 2028</strong>");
    expect(futureAccelerated).toContain("ou à défaut le <strong>18 novembre 2029</strong>");
  });

  it("keeps the AVIS_LABELS casing as-is in the appréciation text (real Word template never lowercases it)", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "9",
      bonification: "BONIFICATION",
      dateEligibiliteBA: "2026-03-01",
      bareme: 4,
      dernierPromu: { bareme: 4, ancienneteGrade: 2, ancienneteEchelon: 2 },
    });
    expect(html).toContain("(Excellent lors de votre dernier rendez-vous de carrière)");
    expect(html).not.toContain("(excellent lors");
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

  it("groups the 'non promu' message and the barème/ancienneté comparison into a single tight paragraph (<br>-joined), not one <p> per line — confirmed against the real Word document's own paragraph structure (zero blank paragraphs between them)", () => {
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
    const match = html.match(/<p>Malheureusement seuls[\s\S]*?<\/p>/);
    expect(match).not.toBeNull();
    const block = match![0];
    // Every line from "Malheureusement..." through to the last ancienneté-échelon line lives in
    // this one <p>, <br>-separated — no closing </p> appears before "Votre ancienneté dans l'échelon".
    expect(block).toContain("Les critères discriminants");
    expect(block).toContain("Votre barème");
    expect(block).toContain("Votre ancienneté dans l'échelon");
    // 2 "non promu" lines + 6 barème/ancienneté lines = 8 lines -> 7 line breaks, all inside one <p>.
    expect(block.match(/<br>/g)?.length).toBe(7);
  });

  it("keeps the barème comparison in a single tight paragraph even without a 'non promu' message (BA granted case)", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "9",
      bonification: "BONIFICATION",
      dateEligibiliteBA: "2026-03-01",
      bareme: 4,
      ancienneteGrade: 2,
      ancienneteEchelon: 1.442,
      dernierPromu: { bareme: 4, ancienneteGrade: 2, ancienneteEchelon: 1.442 },
    });
    const match = html.match(/<p>Votre barème[\s\S]*?<\/p>/);
    expect(match).not.toBeNull();
    const block = match![0];
    expect(block).toContain("Votre ancienneté dans l'échelon");
    expect(block.match(/<br>/g)?.length).toBe(5);
  });

  it("never appends a closing salutation — the real Word document has none after 'Nous sommes à votre disposition...'", () => {
    const { html } = buildCcmaModelEmail(BASE);
    expect(html).not.toContain("cordialement");
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

  it("does NOT show 'prochaine promotion dans ce grade' for a BA candidate genuinely not retained this cycle — verified against 68 real non-promu letters, none of which carry this sentence", () => {
    const { html } = buildCcmaModelEmail({
      ...BASE,
      echelonSuivant: "9",
      bonification: "NON_PROMU",
      gainSalaireNet: 0,
      pourcentagePromusBa: 30,
      dateFuturePromotion: "2030-03-01",
      dateFuturePromotionSiBA: null,
    });
    expect(html).not.toContain("Votre prochaine promotion dans ce grade");
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
      unsubscribeUrl: "https://spelcca.fr/api/mailing/unsubscribe/abc.def",
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
