import { describe, expect, it } from "vitest";
import { deriveCommissionNature } from "../src/routes/campagnes.js";

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
