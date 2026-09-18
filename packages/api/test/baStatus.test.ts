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

  it("computes baStatus 'hors_fenetre' for a BA marker outside the ancienneté window", () => {
    const result = computeBaStatus({
      echelonActuel: "06",
      grade: "CERTIFIE",
      proTypePromotion: "BA",
      proConfirmee: false,
      ancienneteEchelon: 3.0, // completed the full non-accelerated duration, not an actual BA candidate
    });
    expect(result.baStatus).toBe("hors_fenetre");
  });
});
