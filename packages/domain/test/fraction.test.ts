import { describe, expect, it } from "vitest";
import { simplifierFraction } from "../src/calculations/fraction.js";

describe("simplifierFraction", () => {
  it("reduces a fraction to its lowest terms", () => {
    expect(simplifierFraction(115, 175)).toEqual({ numerateur: 23, denominateur: 35 });
    expect(simplifierFraction(2, 3)).toEqual({ numerateur: 2, denominateur: 3 });
    expect(simplifierFraction(135, 135)).toEqual({ numerateur: 1, denominateur: 1 });
  });

  it("keeps an already-irreducible fraction unchanged", () => {
    expect(simplifierFraction(1, 1)).toEqual({ numerateur: 1, denominateur: 1 });
  });

  it("moves a negative sign onto the numerator", () => {
    expect(simplifierFraction(4, -6)).toEqual({ numerateur: -2, denominateur: 3 });
  });

  it("throws for a zero denominator", () => {
    expect(() => simplifierFraction(1, 0)).toThrow();
  });
});
