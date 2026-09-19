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
    { teacherId: "t1", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE" },
    { teacherId: "t2", nom: "DUBOIS", prenom: "Julien", grade: "CERTIFIE" },
    { teacherId: "t3", nom: "STEPHANE", prenom: "Marie", grade: "CERTIFIE" },
  ];

  it("auto-confirms an exact (post-normalization) nom+prénom match", () => {
    const [result] = matchAdherents([{ adherentId: "a1", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBe("t1");
    expect(result.autoConfirmable).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it("still matches through an accent/case discrepancy the workbook's hard-coded dictionary used to handle", () => {
    const [result] = matchAdherents([{ adherentId: "a2", nom: "dubois", prenom: "Julien", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBe("t2");
    expect(result.autoConfirmable).toBe(true);
  });

  it("flags a low-confidence match for review instead of auto-confirming", () => {
    const [result] = matchAdherents([{ adherentId: "a3", nom: "MARTINE", prenom: "Camil", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBe("t1");
    expect(result.autoConfirmable).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.92);
  });

  it("returns no candidate when nothing is remotely close", () => {
    const [result] = matchAdherents([{ adherentId: "a4", nom: "ZZZZZZ", prenom: "Qqqqqq", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("doesn't suggest a pair whose names only coincidentally overlap — real case: adherent ADANERO Olivia was suggested against teacher BARBERO FLORIAN (43% combined score, a different surname AND a different prénom)", () => {
    const [result] = matchAdherents(
      [{ adherentId: "a10", nom: "ADANERO", prenom: "Olivia", grade: "CERTIFIE" }],
      [...teachers, { teacherId: "t5", nom: "BARBERO", prenom: "FLORIAN", grade: "CERTIFIE" }],
    );
    expect(result.teacherId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("never suggests a pair on the strength of an exact common prénom alone, however different the nom — real cases found by lowering minSuggestionThreshold for testing: an exact first name (Sandrine, Nathalie, Olivier, Valerie...) alone pushed the combined score (nom*0.6 + prénom*0.4) to 49-55%, with nomScore as low as 0.14-0.50 for a completely different surname", () => {
    const commonPrenomCases: [string, string, string, string][] = [
      ["ABBASSI", "Sandrine", "DALMASSO", "Sandrine"],
      ["AUDIBERT", "Nathalie", "XUEREB", "Nathalie"],
      ["ARIZA VARGAS", "Olivier", "SAUSSEREAU", "Olivier"],
      ["ALECH-GERARD", "Nathalie", "THOMAS", "Nathalie"],
      ["AVENEL", "Valerie", "BOLUFER", "Valerie"],
    ];
    for (const [adherentNom, prenom, teacherNom, teacherPrenom] of commonPrenomCases) {
      const [result] = matchAdherents(
        [{ adherentId: "x", nom: adherentNom, prenom, grade: "CERTIFIE" }],
        [{ teacherId: "y", nom: teacherNom, prenom: teacherPrenom, grade: "CERTIFIE" }],
        0.4, // even at a lenient combined-score threshold, the nom floor alone must reject these
      );
      expect(result.teacherId).toBeNull();
    }
  });

  it("still allows a genuine nom near-miss through the nom floor even with a different-looking prénom", () => {
    // "MARTINE"/"MARTIN" (nomScore 0.857) must still clear NOM_SIMILARITY_FLOOR on its own —
    // the existing "flags a low-confidence match for review" test above already covers the
    // combined-score behavior for this pair; this one isolates that the nom floor isn't what
    // would block it.
    const [result] = matchAdherents([{ adherentId: "a3b", nom: "MARTINE", prenom: "Camil", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBe("t1");
  });

  it("honors an explicit minSuggestionThreshold override (admin-configured in Paramètres) instead of the default", () => {
    // nomScore("BERNARDOT", "BERNARD") = 0.75 (clears NOM_SIMILARITY_FLOOR comfortably) but the
    // prénom is unrelated (prenomScore = 0), so the combined score (0.45) sits between 0.4 and
    // 0.6 — this isolates minSuggestionThreshold's effect from the independent nom floor. Uses a
    // standalone candidate list (not `teachers`) so it doesn't tie against an unrelated pair.
    const adherents = [{ adherentId: "a11", nom: "BERNARDOT", prenom: "Xyz", grade: "CERTIFIE" }];
    const candidateTeachers = [{ teacherId: "t5", nom: "BERNARD", prenom: "Camille", grade: "CERTIFIE" }];
    // A lower admin-set threshold lets a weaker combined score through...
    const [lenient] = matchAdherents(adherents, candidateTeachers, 0.4);
    expect(lenient.teacherId).toBe("t5");
    // ...and a stricter one raises the bar even past the default.
    const [strict] = matchAdherents(adherents, candidateTeachers, 0.6);
    expect(strict.teacherId).toBeNull();
  });

  it("rejects a pair below the nom floor even when minSuggestionThreshold is lowered far enough that the combined score alone would pass — real case: adherent ADANERO Olivia was suggested against teacher BARBERO FLORIAN (nomScore 0.43, prenomScore 0.43, 43% combined)", () => {
    const adherents = [{ adherentId: "a12", nom: "ADANERO", prenom: "Olivia", grade: "CERTIFIE" }];
    const candidateTeachers = [...teachers, { teacherId: "t5", nom: "BARBERO", prenom: "FLORIAN", grade: "CERTIFIE" }];
    const [result] = matchAdherents(adherents, candidateTeachers, 0.1);
    expect(result.teacherId).toBeNull();
  });

  it("never assigns the same teacher to two different adherents — the higher-confidence pair wins the contested teacher", () => {
    // Both adherents' closest guess is t1 ("MARTIN Camille"); "MARTIN Camille" itself is the exact
    // match and must win it, leaving the weaker adherent with no candidate rather than a duplicate
    // teacherId (which would violate the DB's unique constraint on MatchCandidate.teacherId).
    const results = matchAdherents(
      [
        { adherentId: "weak", nom: "MARTINE", prenom: "Camil", grade: "CERTIFIE" },
        { adherentId: "exact", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE" },
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
    const [result] = matchAdherents([{ adherentId: "a5", nom: "STEPHANE", prenom: "Marie", grade: "CERTIFIE" }], teachers);
    expect(result.teacherId).toBe("t3");
    expect(result.confidence).toBe(1);
  });

  it("never proposes a match across different grades, even for an otherwise-exact nom+prénom", () => {
    // Reproduces the real bug: an adherent's exact-name teacher exists but under a different
    // grade — that pair must never be suggested, no matter how perfect the name similarity is.
    const [result] = matchAdherents([{ adherentId: "a6", nom: "MARTIN", prenom: "Camille", grade: "AGREGE" }], teachers);
    expect(result.teacherId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("normalizes grade like it does names — case/accent/whitespace differences don't block a real match", () => {
    const [result] = matchAdherents(
      [{ adherentId: "a7", nom: "MARTIN", prenom: "Camille", grade: " certifié " }],
      teachers,
    );
    expect(result.teacherId).toBe("t1");
  });

  it("never proposes a match when either side's grade is unknown", () => {
    const teachersWithUnknownGrade = [{ teacherId: "t4", nom: "MARTIN", prenom: "Camille", grade: null }];
    const [byMissingAdherentGrade] = matchAdherents(
      [{ adherentId: "a8", nom: "MARTIN", prenom: "Camille", grade: null }],
      teachers,
    );
    const [byMissingTeacherGrade] = matchAdherents(
      [{ adherentId: "a9", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE" }],
      teachersWithUnknownGrade,
    );
    expect(byMissingAdherentGrade.teacherId).toBeNull();
    expect(byMissingTeacherGrade.teacherId).toBeNull();
  });
});
