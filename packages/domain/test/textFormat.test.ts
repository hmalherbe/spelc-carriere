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

  it("keeps the raw decimal value with a French comma, matching the real sent mailing verbatim", () => {
    // Verified against the actual 25 mars 2026 CCMA mailing PDF (Yann ADAM: "1,442 an" / "2,328 ans" seen elsewhere).
    expect(formatAnneesDecimalesText(1.442)).toBe("1,442 an");
    expect(formatAnneesDecimalesText(12.997)).toBe("12,997 ans");
    expect(formatAnneesDecimalesText(1.5)).toBe("1,5 an");
  });

  it("pluralizes 'ans' from 2 up, 'an' below 2", () => {
    expect(formatAnneesDecimalesText(1.999)).toBe("1,999 an");
    expect(formatAnneesDecimalesText(2)).toBe("2 ans");
    expect(formatAnneesDecimalesText(2.001)).toBe("2,001 ans");
  });

  it("returns null for null/undefined input", () => {
    expect(formatAnneesDecimalesText(null)).toBeNull();
    expect(formatAnneesDecimalesText(undefined)).toBeNull();
  });
});
