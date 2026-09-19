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
