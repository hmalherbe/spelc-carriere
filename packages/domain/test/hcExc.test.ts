import { describe, expect, it } from "vitest";
import {
  ancienneteCle,
  ancienneteReporteeReclassementHC,
  pointsAccesHorsClasse,
  pointsAccesClasseExceptionnelle,
  reclassement,
} from "../src/calculations/hcExc.js";
import { RECLASSEMENT_AGR_VERS_HORS_CLASSE } from "../src/data/refs.js";

describe("ancienneteCle", () => {
  it("packs échelon and ancienneté the way the workbook's lookup tables key on them", () => {
    expect(ancienneteCle(9, 2)).toBe(92);
    expect(ancienneteCle(11, 9)).toBe(119);
  });
});

describe("pointsAccesHorsClasse", () => {
  it("adds the 2nd-degré bonification for 'Excellent' to the ancienneté points at échelon 9 + 2 years", () => {
    // bonification 2nd degré Excellent = 145, points ancienneté for clé 92 = 0
    expect(pointsAccesHorsClasse("Excellent", 2, 9, 2)).toBe(145);
  });

  it("uses the 1er-degré bonification scale for professeurs des écoles", () => {
    // bonification 1er degré Excellent = 120, points ancienneté for clé 93 = 10
    expect(pointsAccesHorsClasse("Excellent", 1, 9, 3)).toBe(130);
  });

  it("uses the 1er-degré ancienneté column, not the 2nd-degré one, past clé 110 where they diverge", () => {
    // bonification 1er degré Excellent = 120, points ancienneté 1er degré for clé 119 = 120
    expect(pointsAccesHorsClasse("Excellent", 1, 11, 9)).toBe(240);
    // bonification 2nd degré Excellent = 145, points ancienneté 2nd degré for clé 119 = 160
    expect(pointsAccesHorsClasse("Excellent", 2, 11, 9)).toBe(305);
  });
});

describe("pointsAccesClasseExceptionnelle", () => {
  it("uses the agrégé-specific ancienneté scale for corps='agrege'", () => {
    // bonification Excellent = 140, points ancienneté (agrégés) for clé 20 = 3
    expect(pointsAccesClasseExceptionnelle("Excellent", "agrege", 2, 0)).toBe(143);
  });
});

describe("reclassement (approximate VLOOKUP into breakpoint tables)", () => {
  it("matches an exact key", () => {
    expect(reclassement(RECLASSEMENT_AGR_VERS_HORS_CLASSE, 100)).toEqual({
      cle: 100,
      echelonReclassement: 2,
      conservationAnciennete: true,
    });
  });

  it("falls back to the largest key <= the lookup value, like Excel's approximate VLOOKUP", () => {
    // 95 falls between clé 92 and clé 100 -> should resolve to the 92 bracket
    expect(reclassement(RECLASSEMENT_AGR_VERS_HORS_CLASSE, 95)).toEqual({
      cle: 92,
      echelonReclassement: 2,
      conservationAnciennete: true,
    });
  });

  it("can resolve to a lettered échelon (agrégés go up to A1/A2/A3)", () => {
    expect(reclassement(RECLASSEMENT_AGR_VERS_HORS_CLASSE, 120).echelonReclassement).toBe("A1");
  });
});

describe("ancienneteReporteeReclassementHC (ported from the central spreadsheet's own reclassement formula)", () => {
  it("resets to zero when the reclassement doesn't conserve ancienneté", () => {
    expect(ancienneteReporteeReclassementHC(10, 900, false)).toBe(0);
  });

  it("carries the full ancienneté over for a départ échelon other than 9", () => {
    expect(ancienneteReporteeReclassementHC(10, 900, true)).toBe(900);
    expect(ancienneteReporteeReclassementHC(11, 400, true)).toBe(400);
  });

  it("subtracts échelon 9's own 720-day (2-year) minimum when reclassing FROM échelon 9 specifically", () => {
    expect(ancienneteReporteeReclassementHC(9, 900, true)).toBe(180);
  });
});
