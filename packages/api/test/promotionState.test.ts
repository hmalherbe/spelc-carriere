import { describe, expect, it } from "vitest";
import { resolveDateProchainePromotion } from "../src/promotionState.js";

const RECTORAT_DATE = new Date("2026-02-05"); // the rectorat's raw "BA.05/02/2026" marker, unconfirmed
const COMPUTED_DATE = new Date("2027-02-05"); // computeEchelonPromotion's normal (non-accelerated) projection

describe("resolveDateProchainePromotion", () => {
  it("falls back to the computed (normal PPCR) date for a BA candidate NOT granted the bonification — real case, a CCMI non-promu BA candidate wrongly shown the same date as their eligibility instead of 1 year later", () => {
    expect(resolveDateProchainePromotion("non_promu", RECTORAT_DATE, COMPUTED_DATE)).toBe(COMPUTED_DATE);
    expect(resolveDateProchainePromotion("hors_fenetre", RECTORAT_DATE, COMPUTED_DATE)).toBe(COMPUTED_DATE);
  });

  it("still prefers the rectorat's own date for a BA candidate actually granted the bonification (baStatus 'promu', confirmed or reliquat)", () => {
    expect(resolveDateProchainePromotion("promu", RECTORAT_DATE, COMPUTED_DATE)).toBe(RECTORAT_DATE);
  });

  it("still prefers the rectorat's own date for a non-BA record (baStatus null — AN/CL/RE tracks unaffected)", () => {
    expect(resolveDateProchainePromotion(null, RECTORAT_DATE, COMPUTED_DATE)).toBe(RECTORAT_DATE);
  });

  it("falls back to the computed date when the rectorat gave none at all, regardless of baStatus", () => {
    expect(resolveDateProchainePromotion(null, null, COMPUTED_DATE)).toBe(COMPUTED_DATE);
    expect(resolveDateProchainePromotion("promu", null, COMPUTED_DATE)).toBe(COMPUTED_DATE);
  });

  it("returns null when neither source has a date", () => {
    expect(resolveDateProchainePromotion("non_promu", null, null)).toBeNull();
  });
});
