import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractPdfText } from "../src/pdfText.js";
import { parseRectoratFile } from "../src/rectoratTextParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end check against an actual rectorat PDF export (not a hand-typed fixture) — this is the
 * file real imports will look like. Chosen deliberately small (2 records) and because it contains
 * a genuine encoding glitch in the source PDF, so this also exercises the "flag, don't guess"
 * behavior against real corrupted input, not a synthetic one.
 */
describe("extractPdfText + parseRectoratFile — real rectorat PDF (Agrégés Hors Classe)", () => {
  it("extracts and parses both records, matching an independent count of '!Bareme :' lines", async () => {
    const buf = readFileSync(join(__dirname, "fixtures", "agreges-hc-real.pdf"));
    const text = await extractPdfText(buf);
    const baremeLineCount = (text.match(/!Bareme :/g) ?? []).length;

    const parsed = parseRectoratFile(text);

    expect(parsed.gradeCode).toBe("4511");
    expect(parsed.records).toHaveLength(baremeLineCount);
    expect(parsed.records.map((r) => r.nomUsage).sort()).toEqual(["BAUTIAS", "FORTUNA"]);

    const bautias = parsed.records.find((r) => r.nomUsage === "BAUTIAS")!;
    expect(bautias.warnings.length).toBeGreaterThan(0); // the real PDF's own encoding glitch
    expect(bautias.prenom).toBe("PATRICE"); // rest of the record still usable
  });
});
