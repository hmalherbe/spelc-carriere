import { describe, expect, it } from "vitest";
import { deriveBonification } from "../src/mailing/bonification.js";

describe("deriveBonification", () => {
  it("ANCIENNETE: never a BA candidate at all (typePromotion=AN, confirmed AN)", () => {
    expect(deriveBonification({ typePromotion: "AN", proTypePromotion: "AN", proConfirmee: true })).toBe("ANCIENNETE");
  });

  it("BONIFICATION: BA candidacy confirmed as BA", () => {
    expect(deriveBonification({ typePromotion: "BA", proTypePromotion: "BA", proConfirmee: true })).toBe("BONIFICATION");
  });

  it("NON_PROMU: BA candidate, nothing confirmed yet", () => {
    expect(deriveBonification({ typePromotion: "BA", proTypePromotion: "AN", proConfirmee: false })).toBe("NON_PROMU");
  });

  // Real case from the 25 mars 2026 CCMA mailing: typePromotion carries a stale/unrelated "BA"
  // candidacy marker, but this cycle's actual échelon change got confirmed via the normal track —
  // a CONFIRMED "AN" always overrides a mere "BA" candidacy marker. Checking typePromotion alone
  // (ignoring which type actually got confirmed) misclassified 23 of these 336 real teachers as
  // NON_PROMU instead of ANCIENNETE.
  it("ANCIENNETE: was a BA candidate, but the normal track got confirmed instead (real case)", () => {
    expect(deriveBonification({ typePromotion: "BA", proTypePromotion: "AN", proConfirmee: true })).toBe("ANCIENNETE");
  });

  // Real case (Romain LABORIE): the base typePromotion marker says "AN", but the actual pending
  // decision this cycle (proTypePromotion) is "BA" — a candidacy the naive "typePromotion===BA"
  // check would have missed entirely, wrongly reading this as ANCIENNETE instead of NON_PROMU.
  it("NON_PROMU: typePromotion says AN but proTypePromotion is the pending BA decision (real case)", () => {
    expect(deriveBonification({ typePromotion: "AN", proTypePromotion: "BA", proConfirmee: false })).toBe("NON_PROMU");
  });

  it("ANCIENNETE: no candidacy signal anywhere, nothing confirmed", () => {
    expect(deriveBonification({ typePromotion: null, proTypePromotion: null, proConfirmee: false })).toBe("ANCIENNETE");
  });
});
