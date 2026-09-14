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

  it("does not fabricate a phantom row from a quoted field containing an embedded line break", () => {
    // Reproduces the real-world bug: an unmapped "Commentaire" column with free-text notes,
    // itself containing commas, wrapped over several lines by the source workbook. A
    // quote-naive row splitter cuts this single field into several fake rows, and a fragment
    // can land back on the nom/prénom columns — creating a bogus extra adherent out of a
    // comment sentence.
    const withComment = [
      'Civ.,Nom ,Prénom,Nom naissance,Grade,Ancien échelon,Statut,Type de contrat,Ancien Indice,Date_Effet,Mél.,Mail academique,Departement,Spelc,Commentaire',
      'Mme,FERRER,Florence,,CERTIFIE,7,Titulaire,Contrat définitif,563,01/09/2020,florence.ferrer@example.com,,06,Oui,"Tél. du 20/09/23 : note interne.\nL\'élève a du redoubler, pas de place, donc elle a été replacée dans le public."',
      'M.,MARTIN,Camille,,CERTIFIE,5,Titulaire,Contrat définitif,481,01/09/2023,camille.martin@example.com,,06,Oui,',
    ].join("\n");

    const { records } = parseAdherentCsv(withComment);
    expect(records).toHaveLength(2);
    expect(records.map((r) => `${r.nom} ${r.prenom}`)).toEqual(["FERRER Florence", "MARTIN Camille"]);
  });
});
