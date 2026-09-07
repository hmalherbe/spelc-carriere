import { describe, expect, it } from "vitest";
import { parseAdherentCsv } from "../src/adherentCsvParser.js";

describe("parseAdherentCsv", () => {
  const csv = [
    'Civ.,Nom ,Prénom,Nom naissance,Grade,Ancien échelon,Statut,Type de contrat,Ancien Indice,Date_Effet,Mél.,Mail academique,Departement,Spelc',
    'Mme,MARTIN,Camille,,CERTIFIE,5,Titulaire,Contrat définitif,481,01/09/2023,camille.martin@example.com,,06,Oui',
    'M.,"DUPONT, DE LA TOUR",Julien,DUPONT,AGREGE,8,Titulaire,Contrat définitif,715,15/09/2021,,julien.dupont@ac-nice.fr,83,Oui',
    ",,,,,,,,,,,,,", // blank trailing row some exports leave in
  ].join("\n");

  const { records, unmappedFields } = parseAdherentCsv(csv);

  it("maps every known header, none left unmapped", () => {
    expect(unmappedFields).toEqual([]);
  });

  it("parses the expected number of real rows, skipping the blank trailing one", () => {
    expect(records).toHaveLength(2);
  });

  it("parses a straightforward row", () => {
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

  it("handles a quoted field containing a comma", () => {
    expect(records[1].nom).toBe("DUPONT, DE LA TOUR");
    expect(records[1].mailAcademique).toBe("julien.dupont@ac-nice.fr");
    expect(records[1].mailPersonnel).toBeNull();
  });

  it("reports every known field as unmapped when the header row doesn't match at all", () => {
    const result = parseAdherentCsv("Foo,Bar\n1,2");
    expect(result.unmappedFields.length).toBeGreaterThan(0);
    expect(result.unmappedFields).toContain("nom");
  });

  it("returns an empty result for an empty file", () => {
    expect(parseAdherentCsv("")).toEqual({ records: [], unmappedFields: expect.any(Array) });
  });
});
