import { describe, expect, it } from "vitest";
import { deriveCommissionNature, campagneTypeForSlot, ANNEE_SCOLAIRE_SLOTS } from "../src/routes/campagnes.js";

describe("deriveCommissionNature", () => {
  it("derives ECHELON + the type itself as commission for CCMA/CCMI, ignoring any commissionInput", () => {
    expect(deriveCommissionNature("CCMA")).toEqual({ nature: "ECHELON", commission: "CCMA" });
    expect(deriveCommissionNature("CCMI")).toEqual({ nature: "ECHELON", commission: "CCMI" });
    expect(deriveCommissionNature("CCMA", "CCMI")).toEqual({ nature: "ECHELON", commission: "CCMA" });
  });

  it("derives HC/EXC as nature, with commission taken from commissionInput when given", () => {
    expect(deriveCommissionNature("HC", "CCMA")).toEqual({ nature: "HC", commission: "CCMA" });
    expect(deriveCommissionNature("EXC", "CCMI")).toEqual({ nature: "EXC", commission: "CCMI" });
  });

  it("leaves commission null for HC/EXC when no commissionInput is given — not yet split by degré", () => {
    expect(deriveCommissionNature("HC")).toEqual({ nature: "HC", commission: null });
    expect(deriveCommissionNature("EXC")).toEqual({ nature: "EXC", commission: null });
    expect(deriveCommissionNature("HC", null)).toEqual({ nature: "HC", commission: null });
  });
});

describe("ANNEE_SCOLAIRE_SLOTS / campagneTypeForSlot", () => {
  it("covers exactly the 6 cases the union asked for (étude de faisabilité, 2026-10-15), no duplicates", () => {
    expect(ANNEE_SCOLAIRE_SLOTS).toHaveLength(6);
    const keys = new Set(ANNEE_SCOLAIRE_SLOTS.map((s) => `${s.commission}|${s.nature}`));
    expect(keys.size).toBe(6);
    for (const commission of ["CCMA", "CCMI"] as const) {
      for (const nature of ["ECHELON", "HC", "EXC"] as const) {
        expect(keys.has(`${commission}|${nature}`)).toBe(true);
      }
    }
  });

  it("maps ECHELON slots to the commission itself as type, HC/EXC slots to the nature itself", () => {
    expect(campagneTypeForSlot({ commission: "CCMA", nature: "ECHELON" })).toBe("CCMA");
    expect(campagneTypeForSlot({ commission: "CCMI", nature: "ECHELON" })).toBe("CCMI");
    expect(campagneTypeForSlot({ commission: "CCMA", nature: "HC" })).toBe("HC");
    expect(campagneTypeForSlot({ commission: "CCMI", nature: "HC" })).toBe("HC");
    expect(campagneTypeForSlot({ commission: "CCMA", nature: "EXC" })).toBe("EXC");
    expect(campagneTypeForSlot({ commission: "CCMI", nature: "EXC" })).toBe("EXC");
  });

  it("round-trips through deriveCommissionNature for every slot (the inverse relationship holds)", () => {
    for (const slot of ANNEE_SCOLAIRE_SLOTS) {
      const type = campagneTypeForSlot(slot);
      expect(deriveCommissionNature(type, slot.commission)).toEqual({ nature: slot.nature, commission: slot.commission });
    }
  });
});
