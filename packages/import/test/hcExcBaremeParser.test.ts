import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractPdfText } from "../src/pdfText.js";
import { parseHcExcBaremeFile } from "../src/hcExcBaremeParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("parseHcExcBaremeFile — real rectorat 'Tableau Avancement' PDF (Hors Classe, PEPS)", () => {
  it("extracts every record, ranked and scored", async () => {
    const buf = readFileSync(join(__dirname, "fixtures", "ta-peps-hc-real.pdf"));
    const text = await extractPdfText(buf);
    const parsed = parseHcExcBaremeFile(text);

    expect(parsed.processus).toBe("HORS CLASSE");
    expect(parsed.gradeLabel).toBe("PROF.EPS");
    expect(parsed.annee).toBe(2026);
    expect(parsed.vivier).toBeNull();
    expect(parsed.records).toHaveLength(28);

    // Ranks are contiguous and in the file's own order — the whole point of this format.
    expect(parsed.records.map((r) => r.rang)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));

    const first = parsed.records[0];
    expect(first.nomUsage).toBe("PRUNIER");
    expect(first.prenom).toBe("LAURENT");
    expect(first.nomNaissance).toBe("PRUNIER");
    expect(first.dateNaissance).toBe("1979-02-26");
    expect(first.rneEtablissement).toBe("0831196Z");
    expect(first.echelonActuel).toBe("10");
    expect(first.echelonBareme).toBe("10");
    expect(first.ancienneteEchelonTexte).toBe("01a00m00j");
    expect(first.ancienneteBaremeTexte).toBe("02a00m00j");
    expect(first.dateAccesCorps).toBe("2004-09-01");
    expect(first.ancienneteCorpsTexte).toBe("22a00m00j");
    expect(first.appreciationRecteur).toBe("Excellent");
    expect(first.pointsRecteur).toBe(145);
    expect(first.pointsAnciennete).toBe(30);
    expect(first.totalBareme).toBe(175);
    expect(first.choixRecteur).toBe(true);
    expect(first.millesime).toBe(2021);
    expect(first.origine).toBe("SIAE");
    expect(first.avisCE).toBeNull();
    expect(first.avisInspecteur).toBeNull();

    // A wrapped two-word appréciation ("Très\nsatisfaisant") must still parse as one value.
    const guislain = parsed.records.find((r) => r.nomUsage === "GUISLAIN")!;
    expect(guislain.appreciationRecteur).toBe("Très satisfaisant");

    // A record whose "Choix du Recteur" marker is absent (not yet chosen) must read as false, not
    // crash the tail-line parse.
    const lepinois = parsed.records.find((r) => r.nomUsage === "LEPINOIS")!;
    expect(lepinois.choixRecteur).toBe(false);
    expect(lepinois.totalBareme).toBe(165);

    // Every record should have extracted at least the identity + score fields cleanly on this
    // clean real file — no record should be a total loss.
    for (const r of parsed.records) {
      expect(r.nomUsage.length).toBeGreaterThan(0);
      expect(r.totalBareme).not.toBeNull();
    }
  });
});

describe("parseHcExcBaremeFile — real rectorat 'Tableau Avancement' PDF (Classe Exceptionnelle, PEPS)", () => {
  it("extracts every record, including a name that wraps onto an extra line", async () => {
    const buf = readFileSync(join(__dirname, "fixtures", "ta-peps-ce-real.pdf"));
    const text = await extractPdfText(buf);
    const parsed = parseHcExcBaremeFile(text);

    expect(parsed.processus).toBe("CLASSE EXCEPTIONNELLE");
    expect(parsed.vivier).toBe("Vivier 1");
    // Real file has 26 "Ordre" numbers (1..13, 15..26 — see the wrapped-name case below).
    expect(parsed.records).toHaveLength(26);

    const first = parsed.records[0];
    expect(first.nomUsage).toBe("CERUTTI");
    expect(first.prenom).toBe("ANNIE");
    expect(first.nomNaissance).toBe("GARCIA");
    expect(first.dateNaissance).toBe("1967-02-09");
    expect(first.avisCE).toContain("Directrice des Études");
    expect(first.avisInspecteur).toContain("coordonnatrice");
    expect(first.appreciationRecteur).toBeNull();
    expect(first.totalBareme).toBeNull();

    // The wrapped-surname case ("DE BEVY" + "MARTINEZ" -> "DE BEVY MARTINEZ") must still produce
    // a record, not silently vanish, and must carry a warning flagging the guess.
    const wrapped = parsed.records.find((r) => r.rang === 14);
    expect(wrapped).toBeDefined();
    expect(wrapped!.nomUsage).toBe("DE BEVY MARTINEZ");
    expect(wrapped!.warnings.some((w) => w.includes("plusieurs lignes"))).toBe(true);
  });
});

describe("parseHcExcBaremeFile — real rectorat 'Tableau Avancement' PDF (Hors Classe, PLP)", () => {
  it("rejoins a hyphen-wrapped surname exactly, with no warning — the unambiguous case", async () => {
    const buf = readFileSync(join(__dirname, "fixtures", "ta-plp-hc-real.pdf"));
    const text = await extractPdfText(buf);
    const parsed = parseHcExcBaremeFile(text);

    // Real title uses a double-dash arrow and a trailing dot-abbreviated grade label
    // ("AVANCEMENT--> HORS CLASSE P.L.P.") — a different spelling than the PEPS file's, both must
    // parse to the same "HORS CLASSE" processus.
    expect(parsed.processus).toBe("HORS CLASSE");
    expect(parsed.gradeLabel).toBe("P.L.P.");
    expect(parsed.records).toHaveLength(38);
    expect(parsed.records.map((r) => r.rang)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));

    // Real case: "BONNET-" / "SAINT-" / "GEORGES" (3 lines, hyphen-wrapped) must rejoin into one
    // surname with NO warning — this is the unambiguous case, unlike a plain-space wrap.
    const hyphenated = parsed.records.find((r) => r.rang === 6)!;
    expect(hyphenated.nomUsage).toBe("BONNET-SAINT-GEORGES");
    expect(hyphenated.prenom).toBe("CAROLINE");
    expect(hyphenated.nomNaissance).toBe("LESTRA");
    expect(hyphenated.warnings.some((w) => w.includes("plusieurs lignes"))).toBe(false);

    // Real case: nom de naissance identical to (and as multi-line as) nom d'usage — "DELAGE" /
    // "AGNELLI" / "ALEXANDRA" / "DELAGE" / "AGNELLI" — resolved with confidence, no warning,
    // since the two halves match exactly.
    const symmetric = parsed.records.find((r) => r.rang === 30)!;
    expect(symmetric.nomUsage).toBe("DELAGE AGNELLI");
    expect(symmetric.prenom).toBe("ALEXANDRA");
    expect(symmetric.nomNaissance).toBe("DELAGE AGNELLI");
    expect(symmetric.warnings.some((w) => w.includes("plusieurs lignes"))).toBe(false);

    // Real case: the file's very last record has a genuinely malformed tail in the SOURCE data
    // itself ("Excellent Satisfaisant 0 0 0.000", two appréciations concatenated, no millésime) —
    // must be flagged, not silently misparsed as if it were a normal one.
    const malformed = parsed.records.find((r) => r.rang === 38)!;
    expect(malformed.totalBareme).toBeNull();
    expect(malformed.warnings.some((w) => w.includes("barème"))).toBe(true);
  });
});

describe("parseHcExcBaremeFile — échelon 9 candidate with no Millésime/Origine printed at all", () => {
  // Bug réel trouvé le 2026-11-02 en comparant un mailing réel à l'ancienne application : 6
  // candidats (4 grades différents), tous à l'échelon 9 — le premier échelon éligible à la Hors
  // Classe — se sont retrouvés sans appréciation/points/ancienneté/barème dans le mailing généré,
  // alors que ces valeurs étaient bien présentes dans le fichier source. Confirmé via les fichiers
  // "TA_PR*_HC_2025" fournis par l'utilisateur (dérivés du même PDF rectorat) : pour ces 6 candidats
  // précisément, les colonnes "Millésime" et "Origine" sont vides (jamais considérés pour la Hors
  // Classe auparavant) — alors que HC_TAIL_RE exige les deux, donc ne matchait pas du tout,
  // perdant même l'appréciation/les points/le barème qui, eux, étaient bien présents.
  function rawTextFor(tailLine: string): string {
    return (
      "ACADEMIE : NICE TABLEAU AVANCEMENT--> HORS CLASSE CERTIFIE DATE : 01/01/2025\n" +
      "ANNEE : 2025\n" +
      "14\n" +
      "TEST\n" +
      "CANDIDATE\n" +
      "TEST\n" +
      "18/07/1972\n" +
      "sciences de la vie et de la terre\n" +
      "Collège privé Exemple\n" +
      "RNE: 0000000A\n" +
      "Date d'entrée Fct.\n" +
      "Pub:\n" +
      "Ech. actuel: 09\n" +
      "Date d'entrée :\n" +
      "2023-09-01\n" +
      "A : 02a06m05j\n" +
      "MA : reclassement\n" +
      "Ech. barème : 09\n" +
      "Anc : 02a06m05j\n" +
      "Au : 2025-08-31\n" +
      "Mode d'accès au corps\n" +
      "concours d'accès a l'echelon de remuneration 01/09/2023\n" +
      "01a00m00j\n" +
      tailLine +
      "\n"
    );
  }

  it("still extracts appréciation/points/barème when Millésime and Origine are both entirely absent", () => {
    const parsed = parseHcExcBaremeFile(rawTextFor("Très satisfaisant 125 0 125.000"));
    expect(parsed.records).toHaveLength(1);
    const r = parsed.records[0];
    expect(r.appreciationRecteur).toBe("Très satisfaisant");
    expect(r.pointsRecteur).toBe(125);
    expect(r.pointsAnciennete).toBe(0);
    expect(r.totalBareme).toBe(125);
    expect(r.choixRecteur).toBe(false);
    expect(r.millesime).toBeNull();
    expect(r.origine).toBeNull();
    expect(r.warnings.some((w) => w.includes("barème"))).toBe(false);
  });

  it("also reads the 'P' (choix du recteur) marker when present despite no Millésime/Origine", () => {
    const parsed = parseHcExcBaremeFile(rawTextFor("Excellent 145 20 165.000 P"));
    const r = parsed.records[0];
    expect(r.choixRecteur).toBe(true);
    expect(r.totalBareme).toBe(165);
    expect(r.millesime).toBeNull();
    expect(r.origine).toBeNull();
  });
});
