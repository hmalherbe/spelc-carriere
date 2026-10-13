import { describe, expect, it } from "vitest";
import { resolveDateProchainePromotion } from "../src/promotionState.js";

const RECTORAT_DATE = new Date("2026-02-05"); // the rectorat's raw "BA.05/02/2026" marker, unconfirmed
const COMPUTED_DATE = new Date("2027-02-05"); // computeEchelonPromotion's normal (non-accelerated) projection — must NEVER be used for a BA candidate, granted or not

describe("resolveDateProchainePromotion", () => {
  it("adds exactly 1 calendar year onto the rectorat's own date for a BA candidate NOT granted the bonification — real case, Audrey SALICETI (CCMI, promouvable 05/02/2026, non-promu, real next promotion 05/02/2027)", () => {
    expect(resolveDateProchainePromotion("non_promu", RECTORAT_DATE, COMPUTED_DATE)).toEqual(new Date("2027-02-05"));
  });

  it("never falls back to the computeEchelonPromotion recompute for a BA candidate not granted — real case, Jan-César NATAF (CERTIFIE, échelon 6, dateAccesEchelon 2017-09-01, report d'ancienneté 1a04m16j, rectorat's own 'BA.15/04/2025'): the grille recompute lands on 15/04/2019 (nonsensically in the past), while the union confirmed the real next promotion is 15/04/2026 — the rectorat's date plus 1 year, not the recompute", () => {
    const rectoratDate = new Date("2025-04-15");
    const grilleRecompute = new Date("2019-04-15"); // what computeEchelonPromotion derives from his old access date + report credit — must be ignored entirely
    expect(resolveDateProchainePromotion("non_promu", rectoratDate, grilleRecompute)).toEqual(new Date("2026-04-15"));
  });

  it("still prefers the rectorat's own date as-is for a BA candidate actually granted the bonification (baStatus 'promu', confirmed or reliquat) — that one is real, not hypothetical", () => {
    expect(resolveDateProchainePromotion("promu", RECTORAT_DATE, COMPUTED_DATE)).toBe(RECTORAT_DATE);
  });

  it("still prefers the rectorat's own date for a non-BA record (baStatus null — AN/CL/RE tracks unaffected)", () => {
    expect(resolveDateProchainePromotion(null, RECTORAT_DATE, COMPUTED_DATE)).toBe(RECTORAT_DATE);
  });

  it("falls back to the computed date when the rectorat gave none at all, for a non-BA record or an already-granted BA", () => {
    expect(resolveDateProchainePromotion(null, null, COMPUTED_DATE)).toBe(COMPUTED_DATE);
    expect(resolveDateProchainePromotion("promu", null, COMPUTED_DATE)).toBe(COMPUTED_DATE);
  });

  it("returns null for a BA candidate not granted when the rectorat gave no date at all — never substitutes the grille recompute, per the union's explicit rule", () => {
    expect(resolveDateProchainePromotion("non_promu", null, COMPUTED_DATE)).toBeNull();
  });
});
