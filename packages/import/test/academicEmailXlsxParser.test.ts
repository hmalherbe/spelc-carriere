import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseAcademicEmailXlsx } from "../src/academicEmailXlsxParser.js";

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Mails acad");
  sheet.addRows(rows);
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

describe("parseAcademicEmailXlsx", () => {
  it("parses nom/prénom/email from the académie's staff-directory export", async () => {
    const buffer = await buildXlsx([
      ["NOM_USUEL", "PRENOM", "ADRESSE_MAIL", "ACADEMIE", "UAI_OCCUPATION", "TYPE_UAI", "GRADE", "QUALITE_TYPE_ENG"],
      ["ABAD", "Emile", "Emile.Abad@ac-nice.fr", 23, "0060735S", "LYC", "F01427", "CD"],
      ["ABBASSI", "Driss", "Driss.Abbassi1@ac-nice.fr", 23, "0060674A", "LYC", "F01426", "CD"],
    ]);

    const { records, unmappedFields } = await parseAcademicEmailXlsx(buffer);

    expect(unmappedFields).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ nom: "ABAD", prenom: "Emile", email: "Emile.Abad@ac-nice.fr" });
  });

  it("skips a row missing nom, prénom, or email", async () => {
    const buffer = await buildXlsx([
      ["NOM_USUEL", "PRENOM", "ADRESSE_MAIL"],
      ["ABERT", "Cindy", ""],
      ["", "Cindy", "cindy@ac-nice.fr"],
      ["ABAD", "Emile", "emile@ac-nice.fr"],
    ]);
    const { records } = await parseAcademicEmailXlsx(buffer);
    expect(records).toHaveLength(1);
    expect(records[0].nom).toBe("ABAD");
  });

  it("reports unmapped fields when the expected headers aren't found", async () => {
    const buffer = await buildXlsx([["Foo", "Bar"], [1, 2]]);
    const { records, unmappedFields } = await parseAcademicEmailXlsx(buffer);
    expect(records).toEqual([]);
    expect(unmappedFields).toEqual(["NOM_USUEL", "PRENOM", "ADRESSE_MAIL"]);
  });
});
