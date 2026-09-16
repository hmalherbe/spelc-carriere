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

describe("parseAdherentCsv — real ADEL 'adhérents' export header (underscore columns, distinct from the older Jasper export)", () => {
  // Exact header row supplied by the union (tab-separated as copied from their file; built as an
  // array here to keep the value <-> column correspondence below readable and typo-proof).
  const headerCols = [
    "id_personne", "nom_long", "nom", "prenom", "nom_naissance", "date_naissance", "adresse_1", "adresse_2",
    "adresse_3", "code_postal", "ville", "email", "telephone_fixe", "mobile", "spelc", "departement_rattachem",
    "situation", "statut", "contrat", "fonction", "groupe_fonct", "fonction2", "groupe_fonc2", "fonction3",
    "groupe_fonc3", "Correspondant", "discipline", "echelle", "echelon", "indice", "temps_travail", "promo",
    "note_pedagogique", "note_administrative", "date_derniere_inspecti", "type_acces_grade", "annee_acces_grade",
    "Anciennete_deduire", "Reliquat", "Éducateur_chrétien", "Couple", "LIRe", "Revue_locale", "mnec",
    "Soumis_cotisation", "Sympathisant", "Mouvement", "Retraite", "Date_depart_retraite", "Commentaire",
    "num_adherent", "Rendez_vous_de_carrièr", "Vivier_1", "Alerte_Infos",
  ];
  const row = headerCols.map(() => "");
  const set = (col: string, value: string) => {
    row[headerCols.indexOf(col)] = value;
  };
  set("nom", "MARTIN");
  set("prenom", "Camille");
  set("nom_naissance", "DURAND");
  set("email", "camille.martin@example.com");
  set("spelc", "Oui");
  set("departement_rattachem", "06");
  set("statut", "Titulaire");
  set("contrat", "Contrat définitif");
  set("echelon", "5");
  set("indice", "481");
  // Confirmed by the union: despite their generic-sounding names, "echelle" carries the statutory
  // grade ("AGREGE", "CERTIFIE HC"...) and "promo" the date of the last échelon change.
  set("echelle", "CERTIFIE HC");
  set("promo", "01/09/2023");

  const csv = [headerCols.join(","), row.join(",")].join("\n");
  const { records, unmappedFields } = parseAdherentCsv(csv);

  it("maps every field this export actually has a column for, via its underscore/oddly-named headers", () => {
    // civilite and mailAcademique genuinely have no corresponding column in this export (no "Civ."
    // nor separate academic-email column) — everything else does, once mapped.
    expect(unmappedFields).toEqual(expect.arrayContaining(["civilite", "mailAcademique"]));
    expect(unmappedFields).not.toEqual(expect.arrayContaining(["grade", "dateEffet"]));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      nom: "MARTIN",
      prenom: "Camille",
      nomNaissance: "DURAND",
      mailPersonnel: "camille.martin@example.com",
      spelc: "Oui",
      departement: "06",
      statut: "Titulaire",
      typeContrat: "Contrat définitif",
      ancienEchelon: "5",
      ancienIndice: 481,
      grade: "CERTIFIE HC",
      dateEffet: "2023-09-01",
    });
  });
});
