import { describe, expect, it } from "vitest";
import { parseAdherentCsv } from "../src/adherentCsvParser.js";

describe("parseAdherentCsv", () => {
  const csv = [
    'Civ.,Nom ,Prénom,Nom naissance,Grade,Ancien échelon,Statut,Type de contrat,Ancien Indice,Date_Effet,Mél.,Departement,Spelc',
    'Mme,MARTIN,Camille,,CERTIFIE,5,Titulaire,Contrat définitif,481,01/09/2023,camille.martin@example.com,06,Oui',
    'M.,"DUPONT, DE LA TOUR",Julien,DUPONT,AGREGE,8,Titulaire,Contrat définitif,715,15/09/2021,,83,Oui',
    ",,,,,,,,,,,,", // blank trailing row some exports leave in
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
    expect(records[1].mailPersonnel).toBeNull();
  });

  it("extracts civilité from a dedicated 'Civ.' column whose value is already just the civilité, trailing period included", () => {
    expect(records[1].civilite).toBe("M");
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
      'Civ.,Nom ,Prénom,Nom naissance,Grade,Ancien échelon,Statut,Type de contrat,Ancien Indice,Date_Effet,Mél.,Departement,Spelc,Commentaire',
      'Mme,FERRER,Florence,,CERTIFIE,7,Titulaire,Contrat définitif,563,01/09/2020,florence.ferrer@example.com,06,Oui,"Tél. du 20/09/23 : note interne.\nL\'élève a du redoubler, pas de place, donc elle a été replacée dans le public."',
      'M.,MARTIN,Camille,,CERTIFIE,5,Titulaire,Contrat définitif,481,01/09/2023,camille.martin@example.com,06,Oui,',
    ].join("\n");

    const { records } = parseAdherentCsv(withComment);
    expect(records).toHaveLength(2);
    expect(records.map((r) => `${r.nom} ${r.prenom}`)).toEqual(["FERRER Florence", "MARTIN Camille"]);
  });
});

describe("parseAdherentCsv — civilité extracted from 'nom_long' when there's no dedicated 'Civ.' column", () => {
  const csv = [
    "nom_long,nom,prenom",
    "Mme MARTIN Camille,MARTIN,Camille",
    "Mlle DUPONT Julie,DUPONT,Julie",
    "M PETIT Marc,PETIT,Marc", // no trailing period on the civilité token
  ].join("\n");

  const { records } = parseAdherentCsv(csv);

  it("isolates just the leading civilité token, ignoring the rest of the name that follows it", () => {
    expect(records.map((r) => r.civilite)).toEqual(["Mme", "Mlle", "M"]);
  });
});

describe("parseAdherentCsv — ancienIndice tolerates a non-numeric cell instead of producing NaN", () => {
  // Reproduces a real crash: ancienIndice is a Prisma Int? column, and Number("NC") / Number("715,00")
  // both evaluate to NaN — passed straight to Prisma, that throws and takes down the whole import
  // (every other, perfectly valid row included) instead of just this one field being null.
  const csv = ["nom,prenom,indice", "MARTIN,Camille,NC", "DUPONT,Julien,\"715,00\"", "PETIT,Marc,481"].join("\n");

  const { records } = parseAdherentCsv(csv);

  it("falls back to null for an unparseable value and a comma-decimal value, parses a clean integer normally", () => {
    expect(records.map((r) => r.ancienIndice)).toEqual([null, 715, 481]);
  });
});

describe("parseAdherentCsv — dateEffet tolerates a placeholder or out-of-range date instead of crashing on Invalid Date", () => {
  // Reproduces a real production crash (GUILLEMIN Maxime): "00/00/0000" in the "promo" column
  // matches the DD/MM/YYYY digit shape but isn't a real calendar date — dateEffet is a Prisma
  // DateTime? column, and new Date("0000-00-00") is an Invalid Date that Prisma rejects, taking
  // down the whole import over that one row.
  const csv = [
    "nom,prenom,promo",
    "GUILLEMIN,Maxime,00/00/0000", // real-world placeholder "no date" value
    "MARTIN,Camille,31/04/2023", // April has only 30 days
    "DUPONT,Julien,29/02/2023", // 2023 isn't a leap year
    "PETIT,Marc,01/09/2023", // clean, valid date
  ].join("\n");

  const { records } = parseAdherentCsv(csv);

  it("falls back to null for a placeholder or calendar-impossible date, parses a clean date normally", () => {
    expect(records.map((r) => r.dateEffet)).toEqual([null, null, null, "2023-09-01"]);
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
  // Confirmed by the union: this export has no dedicated "Civ." column — the civilité is the
  // leading token of "nom_long" instead ("M. MARTIN Camille"), alongside the full name.
  set("nom_long", "Mme MARTIN Camille");

  const csv = [headerCols.join(","), row.join(",")].join("\n");
  const { records, unmappedFields } = parseAdherentCsv(csv);

  it("maps every field this export actually has a column for, via its underscore/oddly-named headers", () => {
    expect(unmappedFields).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      civilite: "Mme",
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
