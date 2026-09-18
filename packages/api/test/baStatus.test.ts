import { describe, expect, it } from "vitest";
import { computeBaStatus } from "../src/baStatus.js";

describe("computeBaStatus", () => {
  it("detects a BA candidate at échelon 6, whether echelonActuel is zero-padded or not (real case: Yann ADAM, AGREGE)", () => {
    const base = {
      grade: "AGREGE",
      proTypePromotion: "BA",
      proConfirmee: false,
      ancienneteEchelon: 1.442,
    };
    expect(computeBaStatus({ ...base, echelonActuel: "06" }).baEchelonDepart).toBe(6);
    expect(computeBaStatus({ ...base, echelonActuel: "6" }).baEchelonDepart).toBe(6);
  });

  it("detects a BA candidate at échelon 8", () => {
    const result = computeBaStatus({
      echelonActuel: "08",
      grade: "CERTIFIE",
      proTypePromotion: "BA",
      proConfirmee: true,
      ancienneteEchelon: 2,
    });
    expect(result.baEchelonDepart).toBe(8);
  });

  it("does NOT mistake the old arrival-échelon values (07/09) for a BA window — regression guard for the échelon-off-by-one fix", () => {
    // Before deriveEchelonActuelFromProjection (see @spelc/domain), echelonActuel held the section's
    // PROJECTION (arrival) value — a départ-6 BA candidate was stored as "07". Once corrected to hold
    // the départ échelon itself, "07"/"09" are no longer meaningful BA markers at all; treating them
    // as such (échelon 7 or 9) would silently make every BA candidate invisible instead.
    expect(computeBaStatus({ echelonActuel: "07", grade: "AGREGE", proTypePromotion: "BA", proConfirmee: false, ancienneteEchelon: 1.4 }).baEchelonDepart).toBeNull();
    expect(computeBaStatus({ echelonActuel: "09", grade: "CERTIFIE", proTypePromotion: "BA", proConfirmee: false, ancienneteEchelon: 2 }).baEchelonDepart).toBeNull();
  });

  it("returns null baEchelonDepart outside échelons 6/8, and no BA fields fire", () => {
    const result = computeBaStatus({
      echelonActuel: "04",
      grade: "CERTIFIE",
      proTypePromotion: null,
      proConfirmee: false,
      ancienneteEchelon: 1,
    });
    expect(result.baEchelonDepart).toBeNull();
    expect(result.baEligible).toBeNull();
    expect(result.isBaCandidate).toBe(false);
    expect(result.baStatus).toBeNull();
  });

  it("computes baStatus 'non_promu' for a non-agrégé BA candidate in-window but not yet confirmed", () => {
    const result = computeBaStatus({
      echelonActuel: "06",
      grade: "CERTIFIE",
      proTypePromotion: "BA",
      proConfirmee: false,
      ancienneteEchelon: 1.5,
    });
    expect(result.baStatus).toBe("non_promu");
  });

  it("computes baStatus 'promu' for a non-agrégé BA candidate in-window and confirmed", () => {
    const result = computeBaStatus({
      echelonActuel: "06",
      grade: "CERTIFIE",
      proTypePromotion: "BA",
      proConfirmee: true,
      ancienneteEchelon: 1.5,
    });
    expect(result.baStatus).toBe("promu");
  });

  it("computes baStatus 'national' for an agrégé BA candidate in-window, regardless of proConfirmee", () => {
    const result = computeBaStatus({
      echelonActuel: "06",
      grade: "AGREGE",
      proTypePromotion: "BA",
      proConfirmee: false,
      ancienneteEchelon: 1.442,
    });
    expect(result.baStatus).toBe("national");
  });

  it("computes baStatus 'hors_fenetre' for a BA marker outside the ancienneté window, when NOT confirmed", () => {
    const result = computeBaStatus({
      echelonActuel: "06",
      grade: "CERTIFIE",
      proTypePromotion: "BA",
      proConfirmee: false,
      ancienneteEchelon: 3.0, // completed the full non-accelerated duration, not an actual BA candidate
    });
    expect(result.baStatus).toBe("hors_fenetre");
  });

  it("computes baStatus 'promu' for a CONFIRMED BA even when ancienneté falls outside the window — real cases, CCMA du 25 mars 2026 (BRUNO, NIZET, MELVIN, OLIVIERI, PARRA, BOTTON, EYMARD, BEZAC : échelon 6, CERTIFIE, 'Pro BA.' confirmed, ancienneté 2.0-2.85 ans)", () => {
    // A rectorat confirmation ('Pro BA.') is a definitive, final fact — never something to discard
    // just because it falls outside our own approximate candidacy window (see baStatus.ts's own
    // comment on why proConfirmee is now checked BEFORE baEligible). This was the exact bug reported
    // by the union: not one single "Promu" showed up at échelon 6 after the échelon fix, even though
    // the real rectorat file plainly listed 10 confirmed "Pro BA." promotions to échelon 7 that day.
    const realCases = [
      { nom: "BRUNO", ancienneteEchelon: 2.536 },
      { nom: "NIZET", ancienneteEchelon: 2.853 },
      { nom: "MELVIN", ancienneteEchelon: 2.85 },
      { nom: "OLIVIERI", ancienneteEchelon: 2.625 },
      { nom: "PARRA", ancienneteEchelon: 2.206 },
      { nom: "BOTTON", ancienneteEchelon: 2.086 },
      { nom: "EYMARD", ancienneteEchelon: 2.219 },
      { nom: "BEZAC", ancienneteEchelon: 2.008 },
    ];
    for (const { nom, ancienneteEchelon } of realCases) {
      const result = computeBaStatus({
        echelonActuel: "06",
        grade: "CERTIFIE",
        proTypePromotion: "BA",
        proConfirmee: true,
        ancienneteEchelon,
      });
      expect(result.baStatus, `${nom} (ancienneté ${ancienneteEchelon})`).toBe("promu");
      expect(result.baEligible, `${nom} — window estimate itself stays honest, still false`).toBe(false);
    }
  });
});
