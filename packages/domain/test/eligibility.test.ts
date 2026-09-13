import { describe, expect, it } from "vitest";
import {
  isEligibleBonificationAnciennete,
  isEligibleCampagne,
  isEligibleClasseExceptionnelle,
  isEligibleHorsClasse,
} from "../src/calculations/eligibility.js";

describe("isEligibleBonificationAnciennete", () => {
  it("échelon 6: eligible only in the 2nd year (1 <= ancienneté < 2 years)", () => {
    expect(isEligibleBonificationAnciennete(6, 0.5)).toBe(false);
    expect(isEligibleBonificationAnciennete(6, 1)).toBe(true);
    expect(isEligibleBonificationAnciennete(6, 1.5)).toBe(true);
    expect(isEligibleBonificationAnciennete(6, 1.99)).toBe(true);
    expect(isEligibleBonificationAnciennete(6, 2)).toBe(false);
    expect(isEligibleBonificationAnciennete(6, 2.5)).toBe(false);
  });

  it("échelon 8: eligible between 18 and 30 months (1.5 to 2.5 years) inclusive", () => {
    expect(isEligibleBonificationAnciennete(8, 1)).toBe(false);
    expect(isEligibleBonificationAnciennete(8, 1.5)).toBe(true);
    expect(isEligibleBonificationAnciennete(8, 2)).toBe(true);
    expect(isEligibleBonificationAnciennete(8, 2.5)).toBe(true);
    expect(isEligibleBonificationAnciennete(8, 2.6)).toBe(false);
  });
});

describe("isEligibleHorsClasse", () => {
  it("échelon 9 requires at least 2 years' ancienneté in that échelon", () => {
    expect(isEligibleHorsClasse(9, 1.9)).toBe(false);
    expect(isEligibleHorsClasse(9, 2)).toBe(true);
    expect(isEligibleHorsClasse(9, 5)).toBe(true);
  });

  it("échelon 10 or 11 is automatically eligible regardless of ancienneté", () => {
    expect(isEligibleHorsClasse(10, 0)).toBe(true);
    expect(isEligibleHorsClasse(11, 0)).toBe(true);
  });

  it("échelons below 9 are never eligible, whatever the ancienneté", () => {
    expect(isEligibleHorsClasse(8, 10)).toBe(false);
    expect(isEligibleHorsClasse(1, 10)).toBe(false);
  });
});

describe("isEligibleClasseExceptionnelle (règles post-réforme 2024)", () => {
  it("most corps: eligible from échelon 5 of the hors-classe, no ancienneté needed", () => {
    expect(isEligibleClasseExceptionnelle(4, "autre")).toBe(false);
    expect(isEligibleClasseExceptionnelle(5, "autre")).toBe(true);
    expect(isEligibleClasseExceptionnelle(7, "autre")).toBe(true);
  });

  it("agrégés: eligible from échelon 4 of the hors-classe — labelled 'A1' in the AGR/HC_AGR grille", () => {
    expect(isEligibleClasseExceptionnelle(3, "agrege")).toBe(false);
    expect(isEligibleClasseExceptionnelle("A1", "agrege")).toBe(true);
    expect(isEligibleClasseExceptionnelle("A2", "agrege")).toBe(true);
    expect(isEligibleClasseExceptionnelle("A3", "agrege")).toBe(true);
  });

  it("a plain number never matches for an agrégé, since their HC grille labels 4-6 as A1-A3", () => {
    expect(isEligibleClasseExceptionnelle(5, "agrege")).toBe(false);
  });
});

describe("isEligibleCampagne", () => {
  const periodeDebut = "2025-09-01";
  const periodeFin = "2026-08-31";

  it("eligible when the date falls strictly inside the period", () => {
    expect(isEligibleCampagne("2026-02-15", periodeDebut, periodeFin)).toBe(true);
  });

  it("eligible on the exact boundary dates (inclusive)", () => {
    expect(isEligibleCampagne(periodeDebut, periodeDebut, periodeFin)).toBe(true);
    expect(isEligibleCampagne(periodeFin, periodeDebut, periodeFin)).toBe(true);
  });

  it("not eligible before the period starts or after it ends", () => {
    expect(isEligibleCampagne("2025-08-31", periodeDebut, periodeFin)).toBe(false);
    expect(isEligibleCampagne("2026-09-01", periodeDebut, periodeFin)).toBe(false);
  });

  it("not eligible when there is no next promotion date (échelon plafond, ou donnée manquante)", () => {
    expect(isEligibleCampagne(null, periodeDebut, periodeFin)).toBe(false);
  });
});
