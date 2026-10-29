import { describe, expect, it } from "vitest";
import {
  coefficientAppliqueFraction,
  computeReclassementConcours,
  computeReclassementConcoursDepuisHcExc,
  joursRetenusPourService,
} from "../src/calculations/reclassementConcours.js";

describe("coefficientAppliqueFraction (coefficient de reclassement affiché sous forme irréductible)", () => {
  it("reduces a 'coefficient' pondération to its irreducible fraction (115/175 -> 23/35)", () => {
    expect(coefficientAppliqueFraction("AECE", "AGR")).toEqual({ numerateur: 23, denominateur: 35 });
  });

  it("returns a coefficient already reduced to 1/1 as 1/1, not simplified further", () => {
    // MA 1 (135) vers PROFS (135) : coefficient identique, fraction 1/1.
    expect(coefficientAppliqueFraction("MA 1", "PROFS")).toEqual({ numerateur: 1, denominateur: 1 });
  });

  it("returns a direct 'ponderation' fraction unchanged when already irreducible", () => {
    expect(coefficientAppliqueFraction("Activités professionnelles", "AGR")).toEqual({ numerateur: 2, denominateur: 3 });
  });

  it("throws for an unknown nature de service", () => {
    expect(() => coefficientAppliqueFraction("Pas une vraie nature", "AGR")).toThrow();
  });
});

describe("joursRetenusPourService (le détail par ligne que computeReclassementConcours additionne)", () => {
  it("applies the quotité clamp and reflects it in the jours retenus for a quotité below mi-temps", () => {
    // ratio 100/175 ; quotité 0.3 (< 0.5, donc PAS clampée à 1) : round(round(1000*0.3)*100/175) = round(171.4...) = 171
    const avecQuotitePartielle = joursRetenusPourService({ nature: "Instituteur", joursBruts: 1000, quotite: 0.3 }, "AGR");
    expect(avecQuotitePartielle).toBe(171);

    // Sans quotité (défaut 1) : round(round(1000*1)*100/175) = round(571.43) = 571 — bien différent de 171.
    const sansQuotite = joursRetenusPourService({ nature: "Instituteur", joursBruts: 1000 }, "AGR");
    expect(sansQuotite).toBe(571);
    expect(avecQuotitePartielle).not.toBe(sansQuotite);
  });

  it("sums to exactly the same total computeReclassementConcours reports (single source of truth)", () => {
    const services = [
      { nature: "AECE", joursBruts: 1000, quotite: 0.4 },
      { nature: "Activités professionnelles", joursBruts: 900 },
    ];
    const sommeManuelle = services.reduce((acc, s) => acc + joursRetenusPourService(s, "AGR"), 0);
    const result = computeReclassementConcours({ grilleCible: "AGR", services });
    expect(Math.floor(sommeManuelle)).toBe(result.totalJoursRetenus);
  });
});

describe("computeReclassementConcours (Reclt concours & reprise d'ancienneté, ported from the union's 260824_Reclassements.xls)", () => {
  it("weights a single AECE service (coefficient 115) by the ratio to AGR's coefficient (175) and classes the result", () => {
    // ratio = 115/175 ; round(round(1000*1)*ratio) = round(657.142...) = 657
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "AECE", joursBruts: 1000 }],
    });
    expect(result.totalJoursRetenus).toBe(657);
    // AGR cumulative threshold: échelon 2 starts at 360j, échelon 3 at 720j — 657 falls in échelon 2.
    expect(result.echelon).toBe(2);
    expect(result.ancienneteReporteeJours).toBe(297);
  });

  it("applies a direct pondération factor (not a coefficient ratio) for a service like 'Activités professionnelles'", () => {
    // round(round(900*1)*2/3) = round(600) = 600
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Activités professionnelles", joursBruts: 900 }],
    });
    expect(result.totalJoursRetenus).toBe(600);
    expect(result.echelon).toBe(2);
    expect(result.ancienneteReporteeJours).toBe(240);
  });

  it("clamps a quotité below mi-temps (part-time < 50%) to its own fraction, instead of counting it as full-time", () => {
    // quotite 0.4 < 0.5 -> NOT clamped to 1 ; ratio 100/175 ; round(round(1000*0.4)*ratio) = round(228.57...) = 229
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Instituteur", joursBruts: 1000, quotite: 0.4 }],
    });
    expect(result.totalJoursRetenus).toBe(229);
    expect(result.echelon).toBe(1);
  });

  it("clamps a quotité at or above mi-temps (>= 50%) to full-time, same as the spreadsheet's own IF(quotite>=0.5,1,quotite)", () => {
    // quotite 0.5 clamped to 1 (not 0.5) -> round(round(1000*1)*100/175) = round(571.42...) = 571, not round(285.7)=286
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Instituteur", joursBruts: 1000, quotite: 0.5 }],
    });
    expect(result.totalJoursRetenus).toBe(571);
  });

  it("adds the reliquat unweighted and the 60-day 'Contractuel alternant' bonus on top of the weighted days", () => {
    // ratio 135/175 ; round(round(500*1)*ratio) = round(385.71...) = 386 ; + reliquat 50 + bonus 60 = 496
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Contractuel alternant", joursBruts: 500, reliquatJours: 50 }],
    });
    expect(result.totalJoursRetenus).toBe(496);
    expect(result.echelon).toBe(2);
    expect(result.ancienneteReporteeJours).toBe(136);
  });

  it("sums several services before classing the total", () => {
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [
        { nature: "AECE", joursBruts: 1000 },
        { nature: "Activités professionnelles", joursBruts: 900 },
      ],
    });
    expect(result.totalJoursRetenus).toBe(657 + 600);
  });

  it("classes into PROFS (coefficient 135) using PROFS's own cumulative échelon thresholds", () => {
    // ratio 135/135 = 1 -> 1000j retenus ; PROFS échelon 3 starts at 720j, échelon 4 at 1440j.
    const result = computeReclassementConcours({
      grilleCible: "PROFS",
      services: [{ nature: "MA 1", joursBruts: 1000 }],
    });
    expect(result.totalJoursRetenus).toBe(1000);
    expect(result.echelon).toBe(3);
    expect(result.ancienneteReporteeJours).toBe(280);
  });

  it("throws for a service nature not in the union's own SITUATIONS_AVANT_RECLASSEMENT table", () => {
    expect(() => computeReclassementConcours({ grilleCible: "AGR", services: [{ nature: "Pas une vraie nature", joursBruts: 1 }] })).toThrow();
  });
});

describe("computeReclassementConcoursDepuisHcExc (Reclt concours HC et EXC — reconstitution virtuelle)", () => {
  it("reconstructs a Hors Classe PROFS échelon 1 teacher into the AGR classe normale grille", () => {
    const result = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 1,
      dateEchelon: "2024-09-01",
      dateReclassement: "2025-09-01",
    });
    // base théorique (échelon 8 AGR) = 5220j ; +360j acquis dans l'échelon ; *135/175 -> 4304j
    expect(result.baseTheoriqueJours).toBe(5220);
    expect(result.joursAcquisDansEchelon).toBe(360);
    expect(result.totalReconstitueJours).toBe(4304);
    expect(result.nouvelleGrille).toBe("AGR");
    expect(result.nouvelEchelon).toBe(7);
    expect(result.ancienneteReporteeJours).toBe(164);
    expect(result.ancienIndice).toBe(595);
    expect(result.nouvelIndice).toBe(664);
    expect(result.gainSalaireBrut).toBeGreaterThan(0);
    expect(result.gainSalaireNet).toBeGreaterThan(0);
    // coefficient 135 (HC_PROFS) / 175 (AGR) réduit -> 27/35.
    expect(result.coefficientFraction).toEqual({ numerateur: 27, denominateur: 35 });
  });

  it("never lands on a lower indice than the one already held ('conservation de l'indice avant reclassement' — missing from the previous standalone simulator)", () => {
    // EXC_PROFS échelon 5 (indice 895) reconstructed at coefficient 135/175 would land on AGR
    // échelon 11 (indice 835 < 895) without the floor rule — a real downgrade the spreadsheet's
    // own G29 formula explicitly guards against.
    const result = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "EXC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(result.nouvelEchelon).toBe(11);
    expect(result.ancienIndice).toBe(895);
    // The théorique landing indice (835) would be a downgrade — the floor keeps the prior indice.
    expect(result.nouvelIndice).toBe(895);
    expect(result.gainSalaireBrut).toBe(0);
    expect(result.gainSalaireNet).toBe(0);
  });

  it("only adds a majoration when it's actually applicable to the (processus, échelon) pair, ignoring one that isn't", () => {
    // Échelon 1 HC never qualifies for any majoration (all require échelon >= 5/7) — passing one
    // anyway must have no effect, rather than being silently applied where it's not legally due.
    const withIrrelevantMajoration = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 1,
      dateEchelon: "2024-09-01",
      dateReclassement: "2025-09-01",
      majorations: { cn11Jours: 999, hc6Jours: 999 },
    });
    expect(withIrrelevantMajoration.totalReconstitueJours).toBe(4304);
  });

  it("applies the cn11 majoration once the échelon actually qualifies for it", () => {
    // base théorique (échelon 11 AGR, HC échelon 5) = 9360 + 900 = 10260j, 0j acquis dans l'échelon
    // (mêmes dates) -> floor(10260*135/175) = 7914 sans majoration, floor(10360*135/175) = 7992 avec.
    const base = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(base.totalReconstitueJours).toBe(7914);
    const withMajoration = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { cn11Jours: 100 },
    });
    expect(withMajoration.totalReconstitueJours).toBe(7992);
  });

  it("throws for an échelon outside the union's own supported range (1-7 HC, 1-5 EXC)", () => {
    expect(() =>
      computeReclassementConcoursDepuisHcExc({
        grilleOrigine: "HC_PROFS",
        echelonActuel: 8,
        dateEchelon: "2026-09-01",
        dateReclassement: "2026-09-01",
      }),
    ).toThrow();
  });
});
