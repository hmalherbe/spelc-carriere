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
  it("formats a whole-year figure with no months/days", () => {
    expect(formatAnneesDecimalesText(2)).toBe("2 ans");
    expect(formatAnneesDecimalesText(0)).toBe("0 jour");
  });

  it("formats a fractional-year figure into years/months/days", () => {
    expect(formatAnneesDecimalesText(1)).toBe("1 an");
    expect(formatAnneesDecimalesText(2.5)).toBe("2 ans 6 mois");
  });

  it("returns null for null/undefined input", () => {
    expect(formatAnneesDecimalesText(null)).toBeNull();
    expect(formatAnneesDecimalesText(undefined)).toBeNull();
  });
});
