import { describe, expect, it } from "vitest";
import { computeEchelonPromotion } from "@spelc/domain";
import { deriveAncienneteAReporter } from "../src/ancienneteReportee.js";

describe("deriveAncienneteAReporter", () => {
  it("parses the durée for a report d'ancienneté (RE.)", () => {
    expect(deriveAncienneteAReporter("RE", "00a05m15j")).toEqual({ annees: 0, mois: 5, jours: 15 });
  });

  it("parses the durée for a reclassement (CL.)", () => {
    expect(deriveAncienneteAReporter("CL", "01a04m24j")).toEqual({ annees: 1, mois: 4, jours: 24 });
  });

  it("ignores the durée for a normal passage (AN.) — same column, different meaning", () => {
    expect(deriveAncienneteAReporter("AN", "00a00m00j")).toBeNull();
  });

  it("ignores the durée for a bonification d'ancienneté (BA.) — its date comes from the rectorat's own marker instead", () => {
    expect(deriveAncienneteAReporter("BA", "00a00m00j")).toBeNull();
  });

  it("returns null when there's no typePromotion at all", () => {
    expect(deriveAncienneteAReporter(null, "01a00m00j")).toBeNull();
  });

  it("returns null for a RE./CL. record with no durée column", () => {
    expect(deriveAncienneteAReporter("RE", null)).toBeNull();
  });

  it("reproduces the rectorat's own confirmed date — Elise MORIN, AGREGE, real case from the CCMA campaign of 25 mars 2026 (\"CL. 01a04m24j\", \"Pro AN.07/04/2026\")", () => {
    const result = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 4,
      dateDernierChangementEchelon: "2025-09-01",
      ancienneteAReporter: deriveAncienneteAReporter("CL", "01a04m24j"),
    });
    expect(result.dateProchainePromotion).toBe("2026-04-07");
  });

  it("reproduces the rectorat's own confirmed date — Charlotte BOURGEON, AGREGE, real case from the same campaign (\"RE. 00a05m15j\", \"Pro AN.16/03/2026\")", () => {
    const result = computeEchelonPromotion({
      grille: "AGR",
      echelonDepart: 6,
      dateDernierChangementEchelon: "2023-09-01",
      ancienneteAReporter: deriveAncienneteAReporter("RE", "00a05m15j"),
    });
    expect(result.dateProchainePromotion).toBe("2026-03-16");
  });
});
