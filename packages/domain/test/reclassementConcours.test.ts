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

  it("adds the 60-day 'Contractuel alternant' bonus on top of the weighted days", () => {
    // ratio 135/175 ; round(round(500*1)*ratio) = round(385.71...) = 386 ; + bonus 60 = 446
    const result = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Contractuel alternant", joursBruts: 500 }],
    });
    expect(result.totalJoursRetenus).toBe(446);
  });

  it("weights a reliquat (situation 1) that's already folded into joursBruts, same as any other day — not added separately post-coefficient", () => {
    // Reliquat is a UI-level concern (folded into joursBruts before calling this function) — this
    // was tried the other way (added unweighted, post-coefficient) and found wrong against real use.
    // ratio 135/175 ; round(round(550*1)*ratio) = round(424.28...) = 424 ; + bonus 60 = 484
    const avecReliquatFondu = computeReclassementConcours({
      grilleCible: "AGR",
      services: [{ nature: "Contractuel alternant", joursBruts: 500 + 50 }],
    });
    expect(avecReliquatFondu.totalJoursRetenus).toBe(484);
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
    // base théorique (cumul jusqu'à la fin de l'échelon 8 AGR, cf. Données!A45:E55 du classeur) =
    // 6480j ; +360j acquis dans l'échelon ; *135/175 -> 5276j
    expect(result.baseTheoriqueJours).toBe(6480);
    expect(result.joursAcquisDansEchelon).toBe(360);
    expect(result.majorationsJours).toBe(0);
    expect(result.totalAvantCoefficientJours).toBe(6840); // 6480 + 360 + 0
    expect(result.totalReconstitueJours).toBe(5276);
    expect(result.nouvelleGrille).toBe("AGR");
    expect(result.nouvelEchelon).toBe(8);
    expect(result.ancienneteReporteeJours).toBe(56);
    expect(result.ancienIndice).toBe(595);
    expect(result.nouvelIndice).toBe(715);
    expect(result.gainSalaireBrut).toBeGreaterThan(0);
    expect(result.gainSalaireNet).toBeGreaterThan(0);
    // coefficient 135 (HC_PROFS) / 175 (AGR) réduit -> 27/35.
    expect(result.coefficientFraction).toEqual({ numerateur: 27, denominateur: 35 });
  });

  it("real case reported 2026-10-31: Certifié HC échelon 1 au 01/09/2024, reclassement au 01/09/2026 — base théorique 6480j, pas 5220j", () => {
    const result = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 1,
      dateEchelon: "2024-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(result.baseTheoriqueJours).toBe(6480);
    expect(result.joursAcquisDansEchelon).toBe(720);
    expect(result.totalAvantCoefficientJours).toBe(7200);
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

  it("only adds a majoration when it's actually applicable to the (processus, échelon) pair, ignoring dates that aren't", () => {
    // Échelon 1 HC never qualifies for any majoration (all require échelon >= 5/7) — the CN11 dates
    // below would otherwise produce a large majoration, but must have no effect here.
    const withIrrelevantMajoration = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 1,
      dateEchelon: "2024-09-01",
      dateReclassement: "2025-09-01",
      majorations: { dateAccesEchelon11ClasseNormale: "2020-09-01", dateAccesHorsClasse: "2024-09-01" },
    });
    expect(withIrrelevantMajoration.totalReconstitueJours).toBe(5276);
  });

  it("computes the hc6 majoration for HC échelon 7 from dateReclassement (classeur's Calculs!B43 substitution), never from a separately-entered échelon-7 date", () => {
    // Bug réel (2026-10-31) : un Hors Classe échelon 7 n'a jamais de date d'accès au 7e échelon
    // séparée à saisir dans le classeur — Calculs!B43 substitue automatiquement la date d'effet du
    // reclassement. majorationHC6 = joursComptablesEntre(6e échelon, date d'effet) - 1080j.
    const result = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 7,
      dateEchelon: "2020-01-01",
      dateReclassement: "2023-01-01",
      majorations: { dateAccesEchelon6HorsClasse: "2022-01-01" },
    });
    expect(result.baseTheoriqueJours).toBe(12420); // seuil fin échelon 11 (9360) + 3060
    expect(result.joursAcquisDansEchelon).toBe(1080);
    // (2023-01-01 - 2022-01-01) - 1080 = 360 - 1080 = -720.
    expect(result.majorationsJours).toBe(-720);
    expect(result.totalAvantCoefficientJours).toBe(12780);

    // Un éventuel dateAccesEchelon7HorsClasse saisi n'a aucun effet pour HC (champ qui n'existe
    // même pas dans le classeur pour ce cas) — seul EXC l'utilise encore (voir le test EXC ci-dessous).
    const withIgnoredField = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 7,
      dateEchelon: "2020-01-01",
      dateReclassement: "2023-01-01",
      majorations: { dateAccesEchelon6HorsClasse: "2022-01-01", dateAccesEchelon7HorsClasse: "1999-01-01" },
    });
    expect(withIgnoredField.totalAvantCoefficientJours).toBe(12780);
  });

  it("still uses the separately-entered échelon-7 date for EXC's own hc6 majoration (unaffected by the HC substitution above)", () => {
    // EXC_PROFS échelon 4+ : les deux dates restent deux faits indépendants dans le classeur
    // (A20/A21 demandent les deux), jamais la date d'effet du reclassement.
    const result = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "EXC_PROFS",
      echelonActuel: 4,
      dateEchelon: "2020-01-01",
      dateReclassement: "2023-01-01", // sans rapport avec la majoration hc6 ici
      majorations: { dateAccesEchelon6HorsClasse: "2022-01-01", dateAccesEchelon7HorsClasse: "2022-07-01" },
    });
    // (2022-07-01 - 2022-01-01) = 180j ; moins 0 (processus EXC, jamais -1080) = 180j.
    expect(result.majorationsJours).toBe(180);
  });

  it("computes the cn11 majoration from the two access dates once the échelon qualifies for it, with no minoration when bi-admissible (the default)", () => {
    // base théorique (échelon 11 AGR, HC échelon 5) = 9360 + 900 = 10260j, 0j acquis dans l'échelon
    // (mêmes dates) -> floor(10260*135/175) = 7914 sans majoration.
    const base = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(base.totalReconstitueJours).toBe(7914);
    // Durée CN11 (2026-01-01 -> 2026-04-11) = 100j comptables ; pas bi-admissible précisé -> défaut
    // "bi-admissible" (pas de minoration) -> +100j -> floor(10360*135/175) = 7992.
    const withMajoration = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { dateAccesEchelon11ClasseNormale: "2026-01-01", dateAccesHorsClasse: "2026-04-11" },
    });
    expect(withMajoration.totalReconstitueJours).toBe(7992);
  });

  it("reduces (minore) the cn11 majoration by up to 900j when the agent is explicitly not bi-admissible à l'agrégation", () => {
    // Même durée CN11 que le test précédent (100j), mais en-deçà du plafond de minoration de 900j
    // -> la minoration (min(900,100)=100) annule entièrement la majoration : +0j -> floor(10260*135/175) = 7914, comme sans majoration.
    const nonBiAdmissible = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { dateAccesEchelon11ClasseNormale: "2026-01-01", dateAccesHorsClasse: "2026-04-11", biAdmissibleAgregation: false },
    });
    expect(nonBiAdmissible.totalReconstitueJours).toBe(7914);

    // Durée CN11 (2023-09-01 -> 2026-06-11) = 1000j (> plafond 900j) : minoration plafonnée à 900j
    // -> reste 100j, même résultat que le cas bi-admissible avec 100j ci-dessus.
    const dureeLongueNonBiAdmissible = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { dateAccesEchelon11ClasseNormale: "2023-09-01", dateAccesHorsClasse: "2026-06-11", biAdmissibleAgregation: false },
    });
    expect(dureeLongueNonBiAdmissible.totalReconstitueJours).toBe(7992);
  });

  it("computes the hc6 majoration (HC only, minus 3 years) and the exc4 majoration (minus 3 years, floored at 0) from their own access dates", () => {
    // HC6 : échelon 7 HC, durée 2023-09-01 -> 2026-09-01 = 1080j (3 ans) ; moins 3 ans (processus HC) = 0j -> aucun effet.
    const hc6SansEffet = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 7,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { dateAccesEchelon6HorsClasse: "2023-09-01", dateAccesEchelon7HorsClasse: "2026-09-01" },
    });
    const hc6BaseSansMajoration = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "HC_PROFS",
      echelonActuel: 7,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(hc6SansEffet.totalReconstitueJours).toBe(hc6BaseSansMajoration.totalReconstitueJours);

    // EXC4 : échelon 5 EXC, durée accès-échelon4 -> date de reclassement = 1180j ; moins 1080j (3 ans) = 100j.
    const exc4 = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "EXC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
      majorations: { dateAccesEchelon4ClasseExceptionnelle: "2023-05-25" },
    });
    const exc4Base = computeReclassementConcoursDepuisHcExc({
      grilleOrigine: "EXC_PROFS",
      echelonActuel: 5,
      dateEchelon: "2026-09-01",
      dateReclassement: "2026-09-01",
    });
    expect(exc4.totalReconstitueJours).toBeGreaterThan(exc4Base.totalReconstitueJours);
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
