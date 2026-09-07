import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRectoratFile, parseZ2AGEA } from "../src/rectoratTextParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

describe("parseRectoratFile — CERTIFIESCN page 1 (échelons 02 and 03, no avis)", () => {
  const result = parseRectoratFile(fixture("certifies-cn-page1.txt"));

  it("extracts the grade code/label and campaign period", () => {
    expect(result.gradeCode).toBe("4531");
    expect(result.gradeLabel).toContain("PROFESSEUR CERTIFIE CL. NORMALE");
    expect(result.periodeDebut).toBe("2024-09-01");
    expect(result.periodeFin).toBe("2025-08-31");
  });

  it("parses all 3 records across both échelon sections", () => {
    expect(result.records).toHaveLength(3);
  });

  it("parses a straightforward record with full établissement details", () => {
    const r = result.records.find((r) => r.nomUsage === "ANDRIAMASIARISON")!;
    expect(r).toBeDefined();
    expect(r.prenom).toBe("MAMY MIRINAH");
    expect(r.dateNaissance).toBe("2000-09-22");
    expect(r.rneEtablissement).toBe("0060744B");
    expect(r.typeEtablissement).toBe("CLG PR");
    expect(r.nomEtablissement).toBe("NOTRE-DAME DU SACRE COEUR");
    expect(r.codePostal).toBe("06500");
    expect(r.ville).toBe("MENTON");
    expect(r.disciplineCode).toBe("0422E");
    expect(r.disciplineLibelle).toBe("ANGLAIS");
    expect(r.echelonActuel).toBe("02");
    expect(r.dateAccesEchelon).toBe("2023-09-01");
    expect(r.typePromotion).toBe("CL");
    expect(r.dureeRestante).toBe("00a00m00j");
    expect(r.dateProchainePromotionRectorat).toBe("2024-09-01");
    expect(r.avisEvaluation).toBeNull(); // no rendez-vous de carrière at this échelon
    expect(r.ancienneteGrade).toBeCloseTo(0.997);
    expect(r.ancienneteEchelon).toBeCloseTo(2.0);
    expect(r.ageEncodedRectorat).toBe("231110");
    expect(r.warnings).toEqual([]);
  });

  it("correctly assigns échelon 03 records to the second section, not the first", () => {
    const echelon03Records = result.records.filter((r) => r.echelonActuel === "03");
    expect(echelon03Records.map((r) => r.nomUsage).sort()).toEqual(["BIOLCHINI", "HIGGS"]);
  });

  it("parses HIGGS with a longer discipline label ('HIST GEO') without swallowing the duree token", () => {
    const r = result.records.find((r) => r.nomUsage === "HIGGS")!;
    expect(r.disciplineCode).toBe("1000E");
    expect(r.disciplineLibelle).toBe("HIST GEO");
    expect(r.dateAccesEchelon).toBe("2024-01-04");
  });
});

describe("parseRectoratFile — CERTIFIESCN échelon 07 (avis de carrière + edge cases)", () => {
  const result = parseRectoratFile(fixture("certifies-cn-echelon07.txt"));

  it("parses a record with an avis and a 'Pro BA.date' on the person line itself", () => {
    const r = result.records.find((r) => r.nomUsage === "FERRAND")!;
    expect(r).toBeDefined();
    expect(r.avisEvaluation).toBe(4);
    expect(r.typePromotion).toBe("AN");
    expect(r.dureeRestante).toBe("00a00m00j");
    expect(r.dateProchainePromotionRectorat).toBe("2025-03-01");
    expect(r.nomEtablissement).toBe("MARIE FRANCE");
  });

  it("parses a record where the 'BA.date' has no 'Pro' prefix", () => {
    const r = result.records.find((r) => r.nomUsage === "AIACH")!;
    expect(r).toBeDefined();
    expect(r.dateProchainePromotionRectorat).toBe("2025-07-18");
    expect(r.avisEvaluation).toBe(3);
  });

  it("parses a contractuel record with no établissement at all, without crashing", () => {
    const r = result.records.find((r) => r.nomUsage === "NATAF")!;
    expect(r).toBeDefined();
    expect(r.prenom).toBe("JAN CESAR");
    expect(r.dateNaissance).toBe("1976-01-31");
    expect(r.rneEtablissement).toBeNull();
    expect(r.nomEtablissement).toBeNull();
    expect(r.typePromotion).toBe("RE");
    expect(r.dureeRestante).toBe("01a04m16j");
    // still recovers the discipline and the barème block even with no établissement columns
    expect(r.disciplineCode).toBe("1300E");
    expect(r.ancienneteGrade).toBeCloseTo(6.997);
  });
});

describe("parseRectoratFile — AGREGESHC (hors classe, includes an encoding glitch)", () => {
  const result = parseRectoratFile(fixture("agreges-hc-echelon03.txt"));

  it("parses both records without throwing", () => {
    expect(result.records).toHaveLength(2);
  });

  it("flags the record whose duree-restante token is corrupted, instead of guessing", () => {
    const r = result.records.find((r) => r.nomUsage === "BAUTIAS")!;
    expect(r.typePromotion).toBeNull();
    expect(r.dureeRestante).toBeNull();
    expect(r.warnings).toContain("Durée restante illisible (probable glitch d'encodage sur le type de promotion)");
    // the rest of the record is still usable
    expect(r.prenom).toBe("PATRICE");
    expect(r.disciplineLibelle).toBe("E. P. S");
  });

  it("parses the clean record in the same section normally", () => {
    const r = result.records.find((r) => r.nomUsage === "FORTUNA")!;
    expect(r.typePromotion).toBe("RE");
    expect(r.dureeRestante).toBe("01a04m00j");
    expect(r.warnings).toEqual([]);
  });
});

describe("parseZ2AGEA", () => {
  it("decodes the AAMMJJ age encoding (verified against a real rectorat example)", () => {
    expect(parseZ2AGEA("290402")).toEqual({ annees: 29, mois: 4, jours: 2 });
  });
});
