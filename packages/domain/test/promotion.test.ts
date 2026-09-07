import { describe, expect, it } from "vitest";
import { computeEchelonPromotion } from "../src/calculations/promotion.js";
import { parseAncienneteText, ancienneteToBankingDays } from "../src/calculations/anciennete.js";

describe("ancienneté text parsing (the 'XXaYYmZZj' format seen in the rectorat PDFs, e.g. '00a04m24j')", () => {
  it("parses years/months/days", () => {
    expect(parseAncienneteText("00a04m24j")).toEqual({ annees: 0, mois: 4, jours: 24 });
    expect(parseAncienneteText("01a00m00j")).toEqual({ annees: 1, mois: 0, jours: 0 });
  });

  it("returns null for an absent value", () => {
    expect(parseAncienneteText(null)).toBeNull();
    expect(parseAncienneteText("")).toBeNull();
  });

  it("converts to banking-calendar days (30-day months, 360-day years)", () => {
    expect(ancienneteToBankingDays(parseAncienneteText("00a04m24j"))).toBe(144);
    expect(ancienneteToBankingDays(parseAncienneteText("01a00m00j"))).toBe(360);
  });
});

describe("computeEchelonPromotion (ports the Calculs adhérents / ETATS_CCM_CALCULS échelon-change engine)", () => {
  it("projects the next promotion date forward by the grille's durée, on a real calendar", () => {
    const result = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 5,
      dateDernierChangementEchelon: "2023-09-01",
    });
    // AGR échelon 5 -> 6 durée = 2.5 years = 900 banking days = 2y 6m 0j
    expect(result.dateProchainePromotion).toBe("2026-03-01");
    expect(result.echelonSuivant).toBe(6);
    expect(result.indiceActuel).toBe(584);
    expect(result.futurIndice).toBe(623);
    expect(result.gainSalaireNet).toBe(148);
  });

  it("shifts the promotion date earlier when ancienneté is reportée (carried over from a prior situation)", () => {
    const withoutReport = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 5,
      dateDernierChangementEchelon: "2023-09-01",
    });
    const withReport = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 5,
      dateDernierChangementEchelon: "2023-09-01",
      ancienneteAReporter: { annees: 0, mois: 6, jours: 0 },
    });
    expect(withReport.dateProchainePromotion).toBe("2025-09-01");
    expect(withoutReport.dateProchainePromotion).toBe("2026-03-01");
  });

  it("uses overridden grilles/valeurDuPoint when passed (e.g. an admin's edited indices)", () => {
    const result = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 5,
      dateDernierChangementEchelon: "2023-09-01",
      grilles: { AGR: [
        { echelon: 5, echelonSuivant: 6, indice: 600, duree: 2.5 },
        { echelon: 6, echelonSuivant: 7, indice: 700, duree: 3 },
      ] } as never,
      valeurDuPoint: 60,
    });
    expect(result.indiceActuel).toBe(600);
    expect(result.futurIndice).toBe(700);
    expect(result.gainSalaireNet).toBe(Math.round(((700 - 600) * 60 * 0.77) / 12));
  });

  it("reports no next promotion when the current échelon is the grille's ceiling ('MAX')", () => {
    const result = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 11,
      dateDernierChangementEchelon: "2023-09-01",
    });
    expect(result.dateProchainePromotion).toBeNull();
    expect(result.gainSalaireNet).toBe(0);
  });
});
