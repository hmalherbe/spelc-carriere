import { describe, expect, it } from "vitest";
import { computeBASeuils, estimateAgainstSeuil, rankBACandidates, type PromuBA, type BACandidateRanked } from "../src/index.js";

const promus: PromuBA[] = [
  { grade: "PROFS", echelonDepart: 6, barreme: 4, ancienneteGrade: 3.0, ancienneteEchelon: 2.5, age: 350512 },
  { grade: "PROFS", echelonDepart: 6, barreme: 4, ancienneteGrade: 2.5, ancienneteEchelon: 3.0, age: 360212 },
  { grade: "PROFS", echelonDepart: 6, barreme: 3, ancienneteGrade: 4.0, ancienneteEchelon: 1.0, age: 400101 },
  { grade: "PROFS", echelonDepart: 8, barreme: 4, ancienneteGrade: 5.0, ancienneteEchelon: 3.5, age: 300101 },
];

describe("computeBASeuils (infers the 'dernier promu' cutoff per grade+échelon départ, cascading on barème -> ancienneté grade -> ancienneté échelon -> âge)", () => {
  const seuils = computeBASeuils(promus);

  it("groups independently by (grade, échelon départ)", () => {
    expect(seuils).toHaveLength(2);
  });

  it("for PROFS échelon 6, the min barème (3) among promoted teachers sets the cutoff, ignoring the barème-4 teachers", () => {
    const s = seuils.find((s) => s.grade === "PROFS" && s.echelonDepart === 6)!;
    expect(s.minBarreme).toBe(3);
    expect(s.minAncienneteGrade).toBe(4.0);
    expect(s.minAncienneteEchelon).toBe(1.0);
    expect(s.minAge).toBe(400101);
    expect(s.nombrePromusBA).toBe(3);
  });

  it("échelon 8 is tracked as a fully separate group from échelon 6", () => {
    const s = seuils.find((s) => s.grade === "PROFS" && s.echelonDepart === 8)!;
    expect(s.minBarreme).toBe(4);
    expect(s.nombrePromusBA).toBe(1);
  });
});

describe("estimateAgainstSeuil", () => {
  const seuils = computeBASeuils(promus);
  const seuil6 = seuils.find((s) => s.grade === "PROFS" && s.echelonDepart === 6);

  it("estimates a clear win when the candidate's barème beats the threshold", () => {
    expect(
      estimateAgainstSeuil({ grade: "PROFS", echelonDepart: 6, barreme: 4, ancienneteGrade: 0, ancienneteEchelon: 0, age: 999999 }, seuil6),
    ).toBe("promu_estime");
  });

  it("estimates a clear loss when the candidate's barème is below the threshold", () => {
    expect(
      estimateAgainstSeuil({ grade: "PROFS", echelonDepart: 6, barreme: 2, ancienneteGrade: 99, ancienneteEchelon: 99, age: 0 }, seuil6),
    ).toBe("non_promu_estime");
  });

  it("falls through the tie-break cascade when barème matches but ancienneté grade is lower", () => {
    expect(
      estimateAgainstSeuil({ grade: "PROFS", echelonDepart: 6, barreme: 3, ancienneteGrade: 1.0, ancienneteEchelon: 0, age: 0 }, seuil6),
    ).toBe("non_promu_estime");
  });

  it("returns 'indetermine' when there is no observed threshold for that group yet", () => {
    expect(
      estimateAgainstSeuil({ grade: "PROFS", echelonDepart: 6, barreme: 4, ancienneteGrade: 0, ancienneteEchelon: 0, age: 0 }, undefined),
    ).toBe("indetermine");
  });
});

describe("rankBACandidates (exact promu/non-promu split from a section's own count, no per-record 'confirmed' marker needed)", () => {
  const candidates: BACandidateRanked[] = [
    { id: "top-barreme", grade: "PROFS", echelonDepart: 6, barreme: 4, ancienneteGrade: 2.0, ancienneteEchelon: 1.5, age: 34 },
    { id: "second-barreme", grade: "PROFS", echelonDepart: 6, barreme: 3, ancienneteGrade: 2.0, ancienneteEchelon: 1.5, age: 32 },
    { id: "lowest-barreme", grade: "PROFS", echelonDepart: 6, barreme: 2, ancienneteGrade: 5.0, ancienneteEchelon: 3.0, age: 25 },
  ];

  it("promotes exactly the top N by barème, excluding the rest even if only slightly behind", () => {
    const winners = rankBACandidates(candidates, 2);
    expect(winners).toEqual(new Set(["top-barreme", "second-barreme"]));
  });

  it("promotes only the single best candidate when the count is 1", () => {
    expect(rankBACandidates(candidates, 1)).toEqual(new Set(["top-barreme"]));
  });

  it("promotes everyone when the count covers the whole pool", () => {
    expect(rankBACandidates(candidates, 3)).toEqual(new Set(["top-barreme", "second-barreme", "lowest-barreme"]));
  });

  it("falls through the same tie-break cascade as estimateAgainstSeuil (ancienneté grade, then échelon, then youngest wins) when barème ties", () => {
    const tied: BACandidateRanked[] = [
      { id: "older-more-anc-grade", grade: "PROFS", echelonDepart: 8, barreme: 4, ancienneteGrade: 5.0, ancienneteEchelon: 2.0, age: 50 },
      { id: "younger-less-anc-grade", grade: "PROFS", echelonDepart: 8, barreme: 4, ancienneteGrade: 3.0, ancienneteEchelon: 2.0, age: 30 },
    ];
    expect(rankBACandidates(tied, 1)).toEqual(new Set(["older-more-anc-grade"]));
  });
});
