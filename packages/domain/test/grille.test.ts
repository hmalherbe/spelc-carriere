import { describe, expect, it } from "vitest";
import {
  deriveEchelonActuelFromProjection,
  deriveNumericEchelonAliases,
  findEchelonRow,
  gainSalaireBrut,
  gainSalaireNet,
  traitementBrutMensuel,
} from "../src/calculations/grille.js";

describe("grille indiciaire lookups (extracted from the workbook's Données sheet)", () => {
  it("finds the AGR échelon 5 row exactly as it appears in the workbook", () => {
    const row = findEchelonRow("AGR", 5);
    expect(row).toEqual({ echelon: 5, echelonSuivant: 6, indice: 584, duree: 2.5 });
  });

  it("computes the gross monthly traitement for indice 584 (AGR échelon 5)", () => {
    // 584 * 59.07336 / 12 = 2874.9035... -> rounds to 2875
    expect(traitementBrutMensuel(584)).toBe(2875);
  });

  it("matches the real Gain_salaire_net value observed in ETATS_CCM_CALCULS_COMPLETS for échelon 5 (indice 584) -> échelon 6 (indice 623): 148€", () => {
    expect(gainSalaireNet(584, 623)).toBe(148);
  });

  it("computes a gross gain consistent with two independently rounded monthly salaries", () => {
    expect(gainSalaireBrut(584, 623)).toBe(traitementBrutMensuel(623) - traitementBrutMensuel(584));
    expect(gainSalaireBrut(584, 623)).toBe(192);
  });

  it("throws on an échelon that doesn't exist in the grille, instead of silently returning garbage", () => {
    expect(() => findEchelonRow("AGR", 99)).toThrow();
  });

  it("uses an overridden grilles table when one is passed (e.g. edited indices from the database)", () => {
    const overridden = { AGR: [{ echelon: 5, echelonSuivant: 6, indice: 999, duree: 2.5 }] };
    const row = findEchelonRow("AGR", 5, overridden as never);
    expect(row.indice).toBe(999);
  });

  it("uses an overridden valeur du point when one is passed", () => {
    expect(traitementBrutMensuel(584, 60)).toBe(Math.round((584 * 60) / 12));
    expect(gainSalaireNet(584, 623, 60)).toBe(Math.round(((623 - 584) * 60 * 0.77) / 12));
  });
});

describe("deriveNumericEchelonAliases", () => {
  it("returns {} for a grille with no letter-coded échelons", () => {
    expect(deriveNumericEchelonAliases("AGR")).toEqual({});
  });

  it("HC_AGR: continues numbering '04'/'05'/'06' into 'A1'/'A2'/'A3' — verified against real rectorat data", () => {
    expect(deriveNumericEchelonAliases("HC_AGR")).toEqual({ "04": "A1", "05": "A2", "06": "A3" });
  });

  it("EXC_AGR: continues numbering from échelon 1 through all 6 letter-coded rows, including the parallel 'B1' track", () => {
    expect(deriveNumericEchelonAliases("EXC_AGR")).toEqual({
      "02": "A1",
      "03": "A2",
      "04": "A3",
      "05": "B1",
      "06": "B2",
      "07": "B3",
    });
  });

  it("EXC_PROFS: continues numbering from échelon 5 (its letter rows start at 'A2', skipping 'A1')", () => {
    expect(deriveNumericEchelonAliases("EXC_PROFS")).toEqual({ "06": "A2", "07": "A3" });
  });
});

describe("deriveEchelonActuelFromProjection", () => {
  // Confirmed against the real, actually-sent 25 mars 2026 CCMA mailing PDF (568 letters) cross-
  // referenced against the matching rectorat export by name AND by the record's own "Pro
  // AN.DD/MM/YYYY" confirmation date (so these are the exact same person/event, not a coincidence):
  //   Elise MORIN (AGR)     — PDF section "PROJET D'AVANCEMENT ECHELON : 05" — real letter: échelon 4 -> 5
  //   Isabel LLEWELLYN (AGR)— section "06" — real letter: échelon 5 -> 6
  //   Yann ADAM (AGR)       — section "07" — real letter: échelon 6 -> 7
  //   Raphaël YACOUB (PROFS)— section "02" — real letter: échelon 1 -> 2
  it("derives the real départ échelon from the section's projection value (plain numeric grilles)", () => {
    expect(deriveEchelonActuelFromProjection("AGR", "05")).toBe(4);
    expect(deriveEchelonActuelFromProjection("AGR", "06")).toBe(5);
    expect(deriveEchelonActuelFromProjection("AGR", "07")).toBe(6);
    expect(deriveEchelonActuelFromProjection("PROFS", "02")).toBe(1);
  });

  it("works across the plain-numeric -> letter-code boundary (HC_AGR: projection 'A1' means départ was échelon 3)", () => {
    expect(deriveEchelonActuelFromProjection("HC_AGR", "A1")).toBe(3);
    expect(deriveEchelonActuelFromProjection("HC_AGR", "A2")).toBe("A1");
  });

  it("resolves a ceiling échelon's own ambiguous self-referencing row correctly (AGR 11's row also has echelonSuivant=11)", () => {
    // Must return 10 (the real predecessor), not 11 (the ceiling row referencing itself) — this is
    // the duplicate-echelonSuivant case every grille with a "MAX" ceiling row has.
    expect(deriveEchelonActuelFromProjection("AGR", "11")).toBe(10);
  });

  it("throws for a projection échelon nothing in the grille leads to", () => {
    expect(() => deriveEchelonActuelFromProjection("AGR", "99")).toThrow();
  });

  it("accepts an overridden grilles table (e.g. edited indices from the database)", () => {
    const overridden = { AGR: [{ echelon: 5, echelonSuivant: 6, indice: 999, duree: 2.5 }] };
    expect(deriveEchelonActuelFromProjection("AGR", "6", overridden as never)).toBe(5);
  });
});
