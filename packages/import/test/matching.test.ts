import { describe, expect, it } from "vitest";
import { matchAdherents, nameSimilarity, normalizeName } from "../src/matching.js";

describe("normalizeName", () => {
  it("strips accents, case, and non-letter characters", () => {
    expect(normalizeName("Stéphanie")).toBe("STEPHANIE");
    expect(normalizeName("Jean-Marc")).toBe("JEANMARC");
    expect(normalizeName("  Célia ")).toBe("CELIA");
  });
});

describe("nameSimilarity", () => {
  it("is 1 for names that only differ by accent/case/spacing", () => {
    expect(nameSimilarity("Stephanie", "Stéphanie")).toBe(1);
    expect(nameSimilarity("jean marc", "JEAN-MARC")).toBe(1);
  });

  it("is lower for genuinely different names", () => {
    expect(nameSimilarity("Martin", "Bernard")).toBeLessThan(0.5);
  });
});

describe("matchAdherents", () => {
  const teachers = [
    { teacherId: "t1", nom: "MARTIN", prenom: "Camille" },
    { teacherId: "t2", nom: "DUBOIS", prenom: "Julien" },
    { teacherId: "t3", nom: "STEPHANE", prenom: "Marie" },
  ];

  it("auto-confirms an exact (post-normalization) nom+prénom match", () => {
    const [result] = matchAdherents([{ adherentId: "a1", nom: "MARTIN", prenom: "Camille" }], teachers);
    expect(result.teacherId).toBe("t1");
    expect(result.autoConfirmable).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it("still matches through an accent/case discrepancy the workbook's hard-coded dictionary used to handle", () => {
    const [result] = matchAdherents([{ adherentId: "a2", nom: "dubois", prenom: "Julien" }], teachers);
    expect(result.teacherId).toBe("t2");
    expect(result.autoConfirmable).toBe(true);
  });

  it("flags a low-confidence match for review instead of auto-confirming", () => {
    const [result] = matchAdherents([{ adherentId: "a3", nom: "MARTINE", prenom: "Camil" }], teachers);
    expect(result.teacherId).toBe("t1");
    expect(result.autoConfirmable).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.92);
  });

  it("returns no candidate when nothing is remotely close", () => {
    const [result] = matchAdherents([{ adherentId: "a4", nom: "ZZZZZZ", prenom: "Qqqqqq" }], teachers);
    expect(result.teacherId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("never assigns the same teacher to two different adherents — the higher-confidence pair wins the contested teacher", () => {
    // Both adherents' closest guess is t1 ("MARTIN Camille"); "MARTIN Camille" itself is the exact
    // match and must win it, leaving the weaker adherent with no candidate rather than a duplicate
    // teacherId (which would violate the DB's unique constraint on MatchCandidate.teacherId).
    const results = matchAdherents(
      [
        { adherentId: "weak", nom: "MARTINE", prenom: "Camil" },
        { adherentId: "exact", nom: "MARTIN", prenom: "Camille" },
      ],
      teachers,
    );
    const exact = results.find((r) => r.adherentId === "exact")!;
    const weak = results.find((r) => r.adherentId === "weak")!;
    expect(exact.teacherId).toBe("t1");
    expect(exact.confidence).toBe(1);
    expect(weak.teacherId).toBeNull();
  });

  it("doesn't let a similar prénom alone override a clearly different nom", () => {
    // "STEPHANE"/"STEPHANIE" as noms are close, but combined with a matching prénom "Marie" on t3
    // shouldn't outrank an exact nom+prénom match elsewhere for a different adherent.
    const [result] = matchAdherents([{ adherentId: "a5", nom: "STEPHANE", prenom: "Marie" }], teachers);
    expect(result.teacherId).toBe("t3");
    expect(result.confidence).toBe(1);
  });
});
