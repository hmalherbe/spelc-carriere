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

  it("detects a single grade block and extracts its code/label, and the campaign period", () => {
    expect(result.grades).toHaveLength(1);
    expect(result.grades[0].gradeCode).toBe("4531");
    expect(result.grades[0].gradeLabel).toContain("PROFESSEUR CERTIFIE CL. NORMALE");
    expect(result.periodeDebut).toBe("2024-09-01");
    expect(result.periodeFin).toBe("2025-08-31");
  });

  it("parses all 3 records across both échelon sections", () => {
    expect(result.grades[0].records).toHaveLength(3);
  });

  it("parses a straightforward record with full établissement details", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "ANDRIAMASIARISON")!;
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
    expect(r.proTypePromotion).toBe("AN");
    expect(r.proConfirmee).toBe(true); // "Pro AN.01/09/2024" — confirmed, not merely eligible
  });

  it("correctly assigns échelon 03 records to the second section, not the first", () => {
    const echelon03Records = result.grades[0].records.filter((r) => r.echelonActuel === "03");
    expect(echelon03Records.map((r) => r.nomUsage).sort()).toEqual(["BIOLCHINI", "HIGGS"]);
  });

  it("parses HIGGS with a longer discipline label ('HIST GEO') without swallowing the duree token", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "HIGGS")!;
    expect(r.disciplineCode).toBe("1000E");
    expect(r.disciplineLibelle).toBe("HIST GEO");
    expect(r.dateAccesEchelon).toBe("2024-01-04");
  });
});

describe("parseRectoratFile — CERTIFIESCN échelon 07 (avis de carrière + edge cases)", () => {
  const result = parseRectoratFile(fixture("certifies-cn-echelon07.txt"));
  const records = result.grades[0].records;

  it("parses a record with an avis and a 'Pro BA.date' on the person line itself — 'Pro' means CONFIRMED/GRANTED this cycle", () => {
    const r = records.find((r) => r.nomUsage === "FERRAND")!;
    expect(r).toBeDefined();
    expect(r.avisEvaluation).toBe(4);
    expect(r.typePromotion).toBe("AN");
    expect(r.dureeRestante).toBe("00a00m00j");
    expect(r.dateProchainePromotionRectorat).toBe("2025-03-01");
    expect(r.nomEtablissement).toBe("MARIE FRANCE");
    expect(r.proTypePromotion).toBe("BA");
    expect(r.proConfirmee).toBe(true);
  });

  it("parses a record where the 'BA.date' has no 'Pro' prefix — meaning ELIGIBLE (candidate) but not yet granted", () => {
    const r = records.find((r) => r.nomUsage === "AIACH")!;
    expect(r).toBeDefined();
    expect(r.dateProchainePromotionRectorat).toBe("2025-07-18");
    expect(r.avisEvaluation).toBe(3);
    expect(r.proTypePromotion).toBe("BA");
    expect(r.proConfirmee).toBe(false);
  });

  it("parses a contractuel record with no établissement at all, without crashing", () => {
    const r = records.find((r) => r.nomUsage === "NATAF")!;
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
    // also carries an unconfirmed "BA.date" marker (eligible, not granted) alongside its RE track
    expect(r.proTypePromotion).toBe("BA");
    expect(r.proConfirmee).toBe(false);
  });
});

describe("parseRectoratFile — AGREGESHC (hors classe, includes an encoding glitch)", () => {
  const result = parseRectoratFile(fixture("agreges-hc-echelon03.txt"));
  const records = result.grades[0].records;

  it("parses both records without throwing", () => {
    expect(records).toHaveLength(2);
  });

  it("flags the record whose duree-restante token is corrupted, instead of guessing", () => {
    const r = records.find((r) => r.nomUsage === "BAUTIAS")!;
    expect(r.typePromotion).toBeNull();
    expect(r.dureeRestante).toBeNull();
    expect(r.warnings).toContain("Durée restante illisible (probable glitch d'encodage sur le type de promotion)");
    // the rest of the record is still usable
    expect(r.prenom).toBe("PATRICE");
    expect(r.disciplineLibelle).toBe("E. P. S");
  });

  it("parses the clean record in the same section normally", () => {
    const r = records.find((r) => r.nomUsage === "FORTUNA")!;
    expect(r.typePromotion).toBe("RE");
    expect(r.dureeRestante).toBe("01a04m00j");
    expect(r.warnings).toEqual([]);
  });
});

describe("parseRectoratFile — AGREGES-CN échelon 07 (real production excerpt, spans 2 physical pages, no 'Pro' on the 2 actually-promoted BA candidates)", () => {
  const result = parseRectoratFile(fixture("agrege-cn-echelon07.txt"));
  const grade = result.grades[0];

  it("detects a single grade block and extracts its code/label", () => {
    expect(result.grades).toHaveLength(1);
    expect(grade.gradeCode).toBe("4512");
    expect(grade.gradeLabel).toContain("PROFESSEUR AGREGE CL. NORMALE");
  });

  it("parses all 5 records, merging both physical pages of the same échelon section", () => {
    expect(grade.records).toHaveLength(5);
    expect(grade.records.map((r) => r.nomUsage)).toEqual(["ADAM", "LABORIE", "LOMBARD", "BOURGEON", "BALLOUARD"]);
  });

  it("extracts the section's 'NOMBRE DE PROMUS' footer once, from the page where it actually appears", () => {
    expect(grade.sections).toEqual([{ echelon: "07", nombrePromusBA: 2, nombrePromusAN: 3 }]);
  });

  it("ADAM and LABORIE carry an unconfirmed BA marker (no 'Pro') despite being the section's actual 2 BA promus", () => {
    const adam = grade.records.find((r) => r.nomUsage === "ADAM")!;
    const laborie = grade.records.find((r) => r.nomUsage === "LABORIE")!;
    expect(adam.proTypePromotion).toBe("BA");
    expect(adam.proConfirmee).toBe(false);
    expect(adam.avisEvaluation).toBe(4);
    expect(laborie.proTypePromotion).toBe("BA");
    expect(laborie.proConfirmee).toBe(false);
    expect(laborie.avisEvaluation).toBe(3);
  });

  it("the other 3 (AN track, non-competitive) are confirmed via 'Pro AN.date' and carry no BA marker", () => {
    for (const nom of ["LOMBARD", "BOURGEON", "BALLOUARD"]) {
      const r = grade.records.find((r) => r.nomUsage === nom)!;
      expect(r.proTypePromotion).toBe("AN");
      expect(r.proConfirmee).toBe(true);
    }
  });
});

describe("parseRectoratFile — multi-grade file (combined CN + HC export, two distinct grade codes)", () => {
  // Synthesized by concatenating a CN block (agrege-cn-echelon07.txt, grade 4512) and an HC block
  // (agreges-hc-echelon03.txt, grade 4511) one after another, exactly as the rectorat's own combined
  // "CN-HC-CE" exports do — each physical page repeats its own "NNNN : ECR..." header.
  const combined = `${fixture("agrege-cn-echelon07.txt")}\n${fixture("agreges-hc-echelon03.txt")}`;
  const result = parseRectoratFile(combined);

  it("detects two distinct grade blocks instead of applying the first grade code to everything", () => {
    expect(result.grades).toHaveLength(2);
    expect(result.grades.map((g) => g.gradeCode)).toEqual(["4512", "4511"]);
  });

  it("attributes each block's records only to its own échelon section, not the other block's", () => {
    const cn = result.grades.find((g) => g.gradeCode === "4512")!;
    const hc = result.grades.find((g) => g.gradeCode === "4511")!;
    expect(cn.records.map((r) => r.nomUsage)).toEqual(["ADAM", "LABORIE", "LOMBARD", "BOURGEON", "BALLOUARD"]);
    expect(hc.records.map((r) => r.nomUsage)).toEqual(["BAUTIAS", "FORTUNA"]);
  });

  it("keeps each block's own échelon section summary separate", () => {
    const cn = result.grades.find((g) => g.gradeCode === "4512")!;
    const hc = result.grades.find((g) => g.gradeCode === "4511")!;
    expect(cn.sections).toEqual([{ echelon: "07", nombrePromusBA: 2, nombrePromusAN: 3 }]);
    expect(hc.sections.map((s) => s.echelon)).toEqual(["03"]);
  });
});

describe("parseRectoratFile — same grade block spanning pages whose trailing column whitespace differs (real case: Certifiés EXC)", () => {
  // Real production file: "4534 : ECR PROFESSEUR CERTIFIE CLASSE EXCEPT." reprints "PERIODE DE
  // TRAITEMENT" on the SAME line as the grade header on every page, with a slightly different amount
  // of column-alignment whitespace before it from page to page (an artefact of the export, not a
  // different grade). Before GRADE_HEADER_RE stopped at the first run of 2+ spaces, that trailing
  // whitespace variance made every page's captured "gradeLabel" a distinct string, so each page
  // formed its own grade block under the (gradeCode, gradeLabel) merge key — and since each new block
  // for the "same" grade code re-triggers teacherSnapshot.deleteMany({ campagneId, grade }) at import
  // time, the previous page's already-imported records were silently wiped out by the next page's.
  const result = parseRectoratFile(fixture("certifies-exc-varying-header-whitespace.txt"));

  it("merges both pages into a single grade block despite the differing trailing whitespace", () => {
    expect(result.grades).toHaveLength(1);
    expect(result.grades[0].gradeCode).toBe("4534");
  });

  it("keeps every record from every page, not just the last one's", () => {
    expect(result.grades[0].records.map((r) => r.nomUsage)).toEqual(["HURAULT", "MARQUETY", "DUFAY"]);
  });

  it("keeps both échelon sections' summaries", () => {
    expect(result.grades[0].sections.map((s) => s.echelon)).toEqual(["03", "04"]);
  });
});

describe("parseZ2AGEA", () => {
  it("decodes the AAMMJJ age encoding (verified against a real rectorat example)", () => {
    expect(parseZ2AGEA("290402")).toEqual({ annees: 29, mois: 4, jours: 2 });
  });
});

describe("parseRectoratFile — premier degré (CCMI) format, real file (PE CN Alpes-Maritimes 2025-2026)", () => {
  // Real production file, uploaded by the union after the secondaire-format parser failed on it
  // entirely ("Aucun grade reconnu dans ce fichier") — its grade/échelon headers, record layout and
  // barème field codes all differ from the secondaire export (see rectoratTextParser.ts's
  // module-level "Premier degré (CCMI) format" comment).
  const result = parseRectoratFile(fixture("pe-cn-alpes-maritimes-real.txt"));

  it("recognizes the grade header despite its code-in-parentheses shape, and the campaign period", () => {
    expect(result.grades).toHaveLength(1);
    expect(result.grades[0].gradeCode).toBe("4051");
    expect(result.grades[0].gradeLabel).toBe("ECR PROFESSEUR DES ECOLES CL. NORMALE");
    expect(result.periodeDebut).toBe("2025-09-01");
    expect(result.periodeFin).toBe("2026-08-31");
  });

  it("parses every record across all 9 échelon sections (03 through 11), none dropped as a bogus footer/header chunk", () => {
    expect(result.grades[0].records).toHaveLength(97);
    expect(result.grades[0].sections.map((s) => s.echelon)).toEqual(["03", "04", "05", "06", "07", "08", "09", "10", "11"]);
  });

  it("splits the civility-prefixed nom+prénom cluster correctly for a straightforward record", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "BIANCO")!;
    expect(r).toBeDefined();
    expect(r.prenom).toBe("OLYMPE");
    expect(r.dateNaissance).toBe("2001-03-30");
    expect(r.rneEtablissement).toBe("0061023E");
    expect(r.typeEtablissement).toBe("E.E.PR");
    expect(r.nomEtablissement).toBe("APRAXINE");
    expect(r.codePostal).toBe("06200");
    expect(r.ville).toBe("NICE");
    expect(r.echelonActuel).toBe("03");
    expect(r.dateAccesEchelon).toBe("2024-09-30");
    expect(r.typePromotion).toBe("AN");
    expect(r.dateProchainePromotionRectorat).toBe("2025-09-30");
    expect(r.proTypePromotion).toBe("AN");
    expect(r.proConfirmee).toBe(true);
  });

  it("splits a compound (particule-prefixed) nom correctly, favoring the last token as the prénom", () => {
    const cases: [string, string][] = [
      ["ROBERT DUBORPER", "LAURIE"],
      ["D ETTORRE", "AURORA"],
      ["DELERCE RAFFALLI", "GAELLE"],
      ["RAGUENET DE SAINT AL", "DIANE"],
    ];
    for (const [nomUsage, prenom] of cases) {
      const r = result.grades[0].records.find((r) => r.nomUsage === nomUsage);
      expect(r, `record for ${nomUsage}`).toBeDefined();
      expect(r!.prenom).toBe(prenom);
    }
  });

  it("converts the AAMMJJ-encoded barème (AVSIAE/Z1AG51/Z2AECH/Z3AGE1) into the same decimal-years convention as the secondaire format's EVAECH line", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "MAZZA")!;
    expect(r).toBeDefined();
    expect(r.avisEvaluation).toBe(4);
    // Z1AG51 080001 = 8 ans 0 mois 1 jour
    expect(r.ancienneteGrade).toBeCloseTo(8 + 0 / 12 + 1 / 360, 6);
    // Z2AECH 010208 = 1 an 2 mois 8 jours
    expect(r.ancienneteEchelon).toBeCloseTo(1 + 2 / 12 + 8 / 360, 6);
    // Z3AGE1 330202 stored raw, like the secondaire format's Z2AGEA — matches the teacher's real age
    // (born 30/06/1992) as of the campaign's reference date (01/09/2025): 33 ans 2 mois 2 jours.
    expect(r.ageEncodedRectorat).toBe("330202");
  });

  it("reads the BA-track marker from line 1 ('BA <date> P', no period, trailing P for confirmed)", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "MAZZA")!;
    expect(r.proTypePromotion).toBe("BA");
    expect(r.dateProchainePromotionRectorat).toBe("2026-06-24");
    expect(r.proConfirmee).toBe(true);

    // BOHSALI's BA marker has no trailing "P" — eligible but not confirmed this cycle.
    const notConfirmed = result.grades[0].records.find((r) => r.nomUsage === "BOHSALI")!;
    expect(notConfirmed.proTypePromotion).toBe("BA");
    expect(notConfirmed.proConfirmee).toBe(false);
  });

  it("reads a 'RE <AAaMMmJJj>' durée-restante marker (space-separated, no period, unlike the secondaire format)", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "LE GAL")!;
    expect(r.typePromotion).toBe("RE");
    expect(r.dureeRestante).toBe("00a04m10j");
  });

  it("handles a record with no établissement (contractuel-style, same as the secondaire format)", () => {
    const r = result.grades[0].records.find((r) => r.nomUsage === "GUIOT")!;
    expect(r).toBeDefined();
    expect(r.rneEtablissement).toBeNull();
    expect(r.typeEtablissement).toBeNull();
    expect(r.nomEtablissement).toBeNull();
    expect(r.dateNaissance).toBe("1965-07-18");
  });

  it("drops every bogus record a naive '!' -agnostic chunk split would produce (unbordered page-break headers and the 'BA AN NBRE DE PROMOUV...' footer summary line)", () => {
    for (const r of result.grades[0].records) {
      expect(r.nomUsage).not.toContain("NBRE DE PROMOUV");
      expect(r.nomUsage).not.toContain("Bureau de gestion");
    }
  });
});
