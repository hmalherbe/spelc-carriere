import { describe, expect, it } from "vitest";
import { deriveNumericEchelonAliases, findEchelonRow, gainSalaireBrut, gainSalaireNet, traitementBrutMensuel } from "../src/calculations/grille.js";

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
