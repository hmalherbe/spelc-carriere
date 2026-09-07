import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseAdherentXlsx } from "../src/adherentXlsxParser.js";

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Export");
  sheet.addRows(rows);
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

describe("parseAdherentXlsx", () => {
  it("parses a workbook's first sheet the same way parseAdherentCsv parses the equivalent CSV", async () => {
    const buffer = await buildXlsx([
      ["Civ.", "Nom", "Prénom", "Nom naissance", "Grade", "Ancien échelon", "Statut", "Type de contrat", "Ancien Indice", "Date_Effet", "Mél.", "Mail academique", "Departement", "Spelc"],
      ["Mme", "MARTIN", "Camille", "", "CERTIFIE", "5", "Titulaire", "Contrat définitif", 481, "01/09/2023", "camille.martin@example.com", "", "06", "Oui"],
    ]);

    const { records, unmappedFields } = await parseAdherentXlsx(buffer);

    expect(unmappedFields).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      civilite: "Mme",
      nom: "MARTIN",
      prenom: "Camille",
      grade: "CERTIFIE",
      ancienEchelon: "5",
      ancienIndice: 481,
      dateEffet: "2023-09-01",
      mailPersonnel: "camille.martin@example.com",
      departement: "06",
      spelc: "Oui",
    });
  });

  it("formats a native Excel date cell as the French dd/mm/yyyy parseAdherentCsv expects", async () => {
    const buffer = await buildXlsx([
      ["Nom", "Prenom", "Date_Effet"],
      ["MARTIN", "Camille", new Date(2023, 8, 1)],
    ]);
    const { records } = await parseAdherentXlsx(buffer);
    expect(records[0].dateEffet).toBe("2023-09-01");
  });

  it("returns no records (and reports unmapped fields) for a sheet with no recognizable header", async () => {
    const buffer = await buildXlsx([["Foo", "Bar"], [1, 2]]);
    const { records, unmappedFields } = await parseAdherentXlsx(buffer);
    expect(records).toEqual([]);
    expect(unmappedFields).toContain("nom");
  });
});
