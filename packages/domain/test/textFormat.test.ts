import { describe, expect, it } from "vitest";
import { formatAnneesDecimalesText, formatDureeEncodedText } from "../src/calculations/textFormat.js";

describe("formatDureeEncodedText", () => {
  it("formats a real rectorat report d'ancienneté marker (MOLENAT Marion, verified against the PDF)", () => {
    expect(formatDureeEncodedText("01a01m21j")).toBe("1 an 1 mois 21 jours");
  });

  it("drops zero components", () => {
    expect(formatDureeEncodedText("00a09m03j")).toBe("9 mois 3 jours");
    expect(formatDureeEncodedText("00a00m25j")).toBe("25 jours");
    expect(formatDureeEncodedText("02a00m00j")).toBe("2 ans");
  });

  it("renders an all-zero duration as '0 jour'", () => {
    expect(formatDureeEncodedText("00a00m00j")).toBe("0 jour");
  });

  it("pluralizes 'an'/'jour' but not 'mois'", () => {
    expect(formatDureeEncodedText("01a01m01j")).toBe("1 an 1 mois 1 jour");
    expect(formatDureeEncodedText("02a02m02j")).toBe("2 ans 2 mois 2 jours");
  });

  it("returns null for null/unparseable input", () => {
    expect(formatDureeEncodedText(null)).toBeNull();
    expect(formatDureeEncodedText(undefined)).toBeNull();
    expect(formatDureeEncodedText("not a duration")).toBeNull();
  });
});

describe("formatAnneesDecimalesText", () => {
  it("formats a whole-year figure with no decimal part", () => {
    expect(formatAnneesDecimalesText(2)).toBe("2 ans");
    expect(formatAnneesDecimalesText(0)).toBe("0 an");
  });

  it("rounds the decimal value to 1 digit, French comma (per product decision — the raw CCMI-sourced figure can carry many meaningless decimals)", () => {
    expect(formatAnneesDecimalesText(1.442)).toBe("1,4 an");
    expect(formatAnneesDecimalesText(1.5)).toBe("1,5 an");
    // Real CCMI case: Z1AG51 080001 (8 ans 0 mois 1 jour) -> 8 + 1/360 via ancienneteToBankingDays.
    expect(formatAnneesDecimalesText(9.002777777777778)).toBe("9 ans");
  });

  it("rounds up to a whole number with no trailing decimal shown, same as a value given whole", () => {
    expect(formatAnneesDecimalesText(12.997)).toBe("13 ans");
    expect(formatAnneesDecimalesText(1.999)).toBe("2 ans");
  });

  it("pluralizes 'ans'/'an' based on the rounded (displayed) value, not the raw input", () => {
    expect(formatAnneesDecimalesText(1.94)).toBe("1,9 an");
    expect(formatAnneesDecimalesText(2.001)).toBe("2 ans");
  });

  it("returns null for null/undefined input", () => {
    expect(formatAnneesDecimalesText(null)).toBeNull();
    expect(formatAnneesDecimalesText(undefined)).toBeNull();
  });
});
