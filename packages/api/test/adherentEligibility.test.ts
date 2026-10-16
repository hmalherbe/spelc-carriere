import { describe, expect, it } from "vitest";
import { computeAdherentEligibility } from "../src/adherentEligibility.js";

// "CERTIFIE" (grille PROFS, degré 2 -> CCMA) and "Prof. Ecoles" (grille PROFS, degré 1 -> CCMI)
// share the same grille, so the same échelon/date inputs produce the same computed
// dateProchainePromotion for both — isolating the assertions below to the degré/commission filter
// itself rather than any difference in the échelon progression.
const adherentCCMA = { grade: "CERTIFIE", ancienEchelon: "5", dateEffet: new Date("2023-09-01") };
const adherentCCMI = { grade: "Prof. Ecoles", ancienEchelon: "5", dateEffet: new Date("2023-09-01") };

// Wide enough that whichever date computeEchelonPromotion lands on for the fixtures above, it
// falls inside — only the commission/degré filter is under test here, not the date window.
const campagneSansPeriodeRestrictive = { periodeDebut: new Date("2020-01-01"), periodeFin: new Date("2030-01-01") };

describe("computeAdherentEligibility — filtre par commission", () => {
  it("un adhérent second degré (CCMA) est éligible pour une campagne CCMA", () => {
    const result = computeAdherentEligibility(adherentCCMA, { ...campagneSansPeriodeRestrictive, commission: "CCMA" });
    expect(result.degre).toBe(2);
    expect(result.eligible).toBe(true);
  });

  it("un adhérent second degré (CCMA) n'est PAS éligible pour une campagne CCMI — bug réel : les deux listes se dupliquaient", () => {
    const result = computeAdherentEligibility(adherentCCMA, { ...campagneSansPeriodeRestrictive, commission: "CCMI" });
    expect(result.eligible).toBe(false);
  });

  it("un adhérent premier degré (CCMI) est éligible pour une campagne CCMI", () => {
    const result = computeAdherentEligibility(adherentCCMI, { ...campagneSansPeriodeRestrictive, commission: "CCMI" });
    expect(result.degre).toBe(1);
    expect(result.eligible).toBe(true);
  });

  it("un adhérent premier degré (CCMI) n'est PAS éligible pour une campagne CCMA", () => {
    const result = computeAdherentEligibility(adherentCCMI, { ...campagneSansPeriodeRestrictive, commission: "CCMA" });
    expect(result.eligible).toBe(false);
  });

  it("reste permissif (pas de filtre) quand la commission de la campagne n'est pas renseignée", () => {
    expect(computeAdherentEligibility(adherentCCMA, campagneSansPeriodeRestrictive).eligible).toBe(true);
    expect(computeAdherentEligibility(adherentCCMI, campagneSansPeriodeRestrictive).eligible).toBe(true);
  });
});

describe("computeAdherentEligibility — maîtres délégués (MD 1/MD 2) exclus (procédure d'avancement séparée)", () => {
  const md1 = { grade: "MD 1", ancienEchelon: "3", dateEffet: new Date("2023-09-01") };
  const md2 = { grade: "MD 2", ancienEchelon: "3", dateEffet: new Date("2023-09-01") };

  it("MD 1 n'est jamais éligible, ni CCMA ni CCMI", () => {
    expect(computeAdherentEligibility(md1, { ...campagneSansPeriodeRestrictive, commission: "CCMI" }).eligible).toBe(false);
    expect(computeAdherentEligibility(md1, { ...campagneSansPeriodeRestrictive, commission: "CCMA" }).eligible).toBe(false);
    expect(computeAdherentEligibility(md1, campagneSansPeriodeRestrictive).eligible).toBe(false);
  });

  it("MD 2 n'est jamais éligible, ni CCMA ni CCMI", () => {
    expect(computeAdherentEligibility(md2, { ...campagneSansPeriodeRestrictive, commission: "CCMI" }).eligible).toBe(false);
    expect(computeAdherentEligibility(md2, { ...campagneSansPeriodeRestrictive, commission: "CCMA" }).eligible).toBe(false);
    expect(computeAdherentEligibility(md2, campagneSansPeriodeRestrictive).eligible).toBe(false);
  });
});
