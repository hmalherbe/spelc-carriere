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

  it("resolves the previously-missing clé 94 bracket for PROFS and AGR (2026-11-01 fix — see refs.ts)", () => {
    const profs = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "PROFS",
      echelonActuel: 9,
      ancienneteJoursAuReference: 1440, // 4 ans -> clé 9*10+4 = 94
      dateReference: "2026-09-01",
    });
    expect(profs.nouvelEchelon).toBe(3);
    expect(profs.ancienneteReporteeJours).toBe(0); // conservation=false sur ce palier

    const agr = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "AGR",
      echelonActuel: 9,
      ancienneteJoursAuReference: 1440,
      dateReference: "2026-09-01",
    });
    expect(agr.nouvelEchelon).toBe(3);
  });

  it("supports BI_ADM (bi-admissible) and PEGC origins for Hors Classe, and PEGC's own Hors Classe for Classe Exceptionnelle", () => {
    // clé 92 (échelon 9 + 2 ans, en dessous de la plus petite clé des deux tables) -> exact.
    // BI_ADM atterrit dans HC_PROFS ordinaire, pas une grille "HC_BI_ADM" inexistante.
    const biAdm = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "BI_ADM",
      echelonActuel: 9,
      ancienneteJoursAuReference: 720,
      dateReference: "2026-09-01",
    });
    expect(biAdm.nouvelleGrille).toBe("HC_PROFS");
    expect(biAdm.nouvelEchelon).toBe(3);

    const pegc = computeReclassementHcExc({
      processus: "HC",
      grilleActuelle: "PEGC",
      echelonActuel: 9,
      ancienneteJoursAuReference: 720,
      dateReference: "2026-09-01",
    });
    expect(pegc.nouvelleGrille).toBe("HC_PEGC");
    expect(pegc.nouvelEchelon).toBe(3);

    const hcPegc = computeReclassementHcExc({
      processus: "EXC",
      grilleActuelle: "HC_PEGC",
      echelonActuel: 5,
      ancienneteJoursAuReference: 0,
      dateReference: "2026-09-01",
    });
    expect(hcPegc.nouvelleGrille).toBe("EXC_PEGC");
    expect(hcPegc.nouvelEchelon).toBe(1);
  });

  it("real case reported 2026-11-01: Certifié classe exceptionnelle échelon 4 -> chevron HEA1 (déjà codé échelon 5 dans GRILLES.EXC_PROFS, indice 895 — confirmé par l'utilisateur, aucune nouvelle donnée d'indice)", () => {
    const result = computeReclassementHcExc({
      processus: "EXC",
      grilleActuelle: "EXC_PROFS",
      echelonActuel: 4,
      ancienneteJoursAuReference: 1000, // sans effet : conservationAnciennete=false ici (voir G11 du classeur)
      dateReference: "2026-09-01",
    });
    expect(result.nouvelleGrille).toBe("EXC_PROFS"); // reste dans la même grille
    expect(result.nouvelEchelon).toBe(5);
    expect(result.ancienIndice).toBe(835);
    expect(result.nouvelIndice).toBe(895);
    expect(result.ancienneteReporteeJours).toBe(0);
  });

  it("real case reported 2026-11-01: Professeur de chaire supérieure échelon 6-HEA2 -> 7-HEB2 (table fournie par l'utilisateur, recoupée avec Données!M58:P68 du classeur)", () => {
    const result = computeReclassementHcExc({
      processus: "EXC",
      grilleActuelle: "CHAIRE_SUP",
      echelonActuel: "6-HEA2",
      ancienneteJoursAuReference: 500, // sans effet : conservationAnciennete=false (G11 exclut CHAIRE_SUP)
      dateReference: "2026-09-01",
    });
    expect(result.nouvelleGrille).toBe("CHAIRE_SUP"); // reste dans la même grille
    expect(result.nouvelEchelon).toBe("7-HEB2");
    expect(result.ancienIndice).toBe(925);
    expect(result.nouvelIndice).toBe(1013);
    expect(result.ancienneteReporteeJours).toBe(0);
  });

  it("throws for a grille with no known reclassement table (e.g. INSTIT, never a HC/EXC origin)", () => {
    expect(() =>
      computeReclassementHcExc({
        processus: "HC",
        grilleActuelle: "INSTIT",
        echelonActuel: 9,
        ancienneteJoursAuReference: 0,
        dateReference: "2026-09-01",
      }),
    ).toThrow();
  });
});
