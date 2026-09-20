import { describe, expect, it } from "vitest";
import { computeReclassementHcExc } from "../src/calculations/hcExcReclassement.js";

describe("computeReclassementHcExc (ported from the central spreadsheet's own reclassement + date_prochaine_promotion VBA formula)", () => {
  it("reclasses a Certifié at échelon 10 (0 ancienneté) into Hors Classe échelon 3, keeping the full ancienneté since départ échelon isn't 9", () => {
    const result = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "PROFS",
      echelonActuel: 10,
      ancienneteJoursAuReference: 0,
      dateReference: "2026-09-01",
    });
    // clé 100 (échelon 10 + 0 ans) matches RECLASSEMENT_PROFS_VERS_HORS_CLASSE's exact "cle: 100"
    // breakpoint -> échelon 3, conservation d'ancienneté.
    expect(result.nouvelleGrille).toBe("HC_PROFS");
    expect(result.nouvelEchelon).toBe(3);
    expect(result.ancienneteReporteeJours).toBe(0);
    expect(result.ancienIndice).toBeGreaterThan(0);
    expect(result.nouvelIndice).toBeGreaterThan(result.ancienIndice);
    expect(result.gainSalaireBrut).toBeGreaterThan(0);
    expect(result.dateProchainePromotion).toBe("2029-03-01");
  });

  it("subtracts échelon 9's own 720-day minimum from the carried-over ancienneté (real business rule, not échelon 10/11's simple carry-over)", () => {
    const fromEchelon9 = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "PROFS",
      echelonActuel: 9,
      ancienneteJoursAuReference: 900, // 2 ans 6 mois
      dateReference: "2026-09-01",
    });
    // clé 92 (échelon 9 + 2.5 ans) matches the exact "cle: 92" breakpoint -> échelon 2,
    // conservation d'ancienneté — but only 900 - 720 = 180 jours actually carry forward.
    expect(fromEchelon9.nouvelEchelon).toBe(2);
    expect(fromEchelon9.ancienneteReporteeJours).toBe(180);

    // Same shape of case (a conservation-d'ancienneté bracket), but a départ échelon other than 9
    // keeps the ancienneté in full — isolates that the -720j carve-out is specific to échelon 9,
    // not a general rule. Clé 101 (échelon 10 + 1 an) falls in the "clé 100" bracket (still below
    // the next breakpoint at 102.5), which also conserves ancienneté.
    const fromEchelon10 = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "PROFS",
      echelonActuel: 10,
      ancienneteJoursAuReference: 360,
      dateReference: "2026-09-01",
    });
    expect(fromEchelon10.nouvelEchelon).toBe(3);
    expect(fromEchelon10.ancienneteReporteeJours).toBe(360);
  });

  it("reclasses Hors Classe into Classe Exceptionnelle using the HC-specific table, with no échelon-9-style carve-out", () => {
    const result = computeReclassementHcExc({
      processus: "EXC",
      grilleActuelle: "HC_PROFS",
      echelonActuel: 3,
      ancienneteJoursAuReference: 720,
      dateReference: "2026-09-01",
    });
    expect(result.nouvelleGrille).toBe("EXC_PROFS");
    expect(result.nouvelEchelon).toBeGreaterThanOrEqual(1);
    expect(result.ancienIndice).toBeGreaterThan(0);
    expect(result.nouvelIndice).toBeGreaterThanOrEqual(result.ancienIndice);
  });
});
