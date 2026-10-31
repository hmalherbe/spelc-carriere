import { describe, expect, it } from "vitest";
import {
  classerParAncienneteJours,
  deriveEchelonActuelFromProjection,
  deriveNumericEchelonAliases,
  findEchelonRow,
  gainSalaireBrut,
  gainSalaireNet,
  rangEchelon,
  seuilEntreeEchelon,
  seuilFinEchelon,
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

  it("still resolves the ceiling's self-referencing row correctly when it's returned BEFORE the real predecessor", () => {
    // Real production bug: loadLiveGrilles (packages/api/src/liveGrilles.ts) loads a grille's rows
    // via `prisma.grille.findMany({ include: { rows: true } })` with no `orderBy` — Postgres gives no
    // ordering guarantee without one, and DID return a grille's ceiling row before its predecessor in
    // production (HC_PROFS: échelon 7 is the ceiling, duree "MAX", echelonSuivant 7 — a self-loop).
    // The old "first match in array order wins" logic silently depended on ascending échelon order to
    // prefer the real predecessor (6) over the self-loop (7) — reversed order instead derived échelon
    // "07" as its own départ (no correction applied at all), reporting every teacher genuinely
    // promoted 6 -> 7 this cycle as already sitting at the grille's ceiling with no promotion to show.
    const reversed = {
      AGR: [
        { echelon: 11, echelonSuivant: 11, indice: 1, duree: "MAX" as const },
        { echelon: 10, echelonSuivant: 11, indice: 1, duree: 2 },
      ],
    };
    expect(deriveEchelonActuelFromProjection("AGR", "11", reversed as never)).toBe(10);
  });
});

describe("seuilEntreeEchelon / classerParAncienneteJours (cumulative échelon thresholds, derived from each row's own duree)", () => {
  it("returns 0 for the first échelon and the sum of prior échelons' durées (in banking days) for later ones", () => {
    expect(seuilEntreeEchelon("AGR", 1)).toBe(0);
    expect(seuilEntreeEchelon("AGR", 2)).toBe(360); // échelon 1's own 1-year duree
    expect(seuilEntreeEchelon("AGR", 8)).toBe(5220); // 1+1+2+2+2.5+3+3 years * 360
  });

  it("throws for an échelon that doesn't exist (numerically) in the grille", () => {
    expect(() => seuilEntreeEchelon("AGR", 99)).toThrow();
  });

  it("classerParAncienneteJours is the exact inverse: classing seuilEntreeEchelon(grille, N) lands back on échelon N with no report", () => {
    const seuil = seuilEntreeEchelon("AGR", 7);
    expect(classerParAncienneteJours("AGR", seuil)).toEqual({ echelon: 7, reportJours: 0 });
  });
});

describe("seuilFinEchelon (cumulative days THROUGH an échelon, not the threshold to enter it)", () => {
  // Valeurs lues directement dans le classeur source (Données!A45:E55, colonne E — celle que
  // VLOOKUP(échelon, AGR, 5, TRUE) utilise réellement) : 360 pour l'échelon 1 (sa propre durée
  // d'1 an), 6480 pour l'échelon 8 (cumul 1+1+2+2+2.5+3+3+3.5 ans) — confirmé par le mismatch
  // réel du 2026-10-31 (Certifié HC échelon 1 : base théorique attendue 6480j, pas 5220j).
  it("equals seuilEntreeEchelon(grille, echelon) + that échelon's own duree, in banking days", () => {
    expect(seuilFinEchelon("AGR", 1)).toBe(360);
    expect(seuilFinEchelon("AGR", 8)).toBe(6480);
    expect(seuilFinEchelon("AGR", 8)).toBe(seuilEntreeEchelon("AGR", 8) + 3.5 * 360);
  });

  it("equals seuilEntreeEchelon for the grille's ceiling échelon (duree 'MAX' contributes nothing further)", () => {
    expect(seuilFinEchelon("AGR", 11)).toBe(seuilEntreeEchelon("AGR", 11));
    expect(seuilFinEchelon("AGR", 11)).toBe(9360);
  });

  it("throws for an échelon that doesn't exist (numerically) in the grille", () => {
    expect(() => seuilFinEchelon("AGR", 99)).toThrow();
  });
});

describe("rangEchelon (1-based position in a grille's own échelon sequence, letter-coded or not)", () => {
  it("returns a plain 1-based position for an all-numeric grille", () => {
    expect(rangEchelon("HC_PROFS", 1)).toBe(1);
    expect(rangEchelon("HC_PROFS", 7)).toBe(7);
  });

  it("keeps counting through a grille's lettered échelons (EXC_PROFS: 1..5 then 'A2'/'A3')", () => {
    expect(rangEchelon("EXC_PROFS", 5)).toBe(5);
    expect(rangEchelon("EXC_PROFS", "A2")).toBe(6);
    expect(rangEchelon("EXC_PROFS", "A3")).toBe(7);
  });

  it("keeps counting through HC_AGR's lettered échelons ('A1'/'A2'/'A3' after the numeric 1-3)", () => {
    expect(rangEchelon("HC_AGR", 3)).toBe(3);
    expect(rangEchelon("HC_AGR", "A1")).toBe(4);
    expect(rangEchelon("HC_AGR", "A3")).toBe(6);
  });

  it("throws for an échelon that doesn't exist in the grille", () => {
    expect(() => rangEchelon("EXC_PROFS", "A4")).toThrow();
    expect(() => rangEchelon("HC_PROFS", 14)).toThrow();
  });
});
