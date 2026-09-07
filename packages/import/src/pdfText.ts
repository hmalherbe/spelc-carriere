import { PDFParse } from "pdf-parse";

/**
 * Extracts plain text from a rectorat campaign PDF export, ready for `parseRectoratFile`.
 *
 * Verified against all 5 real rectorat export files provided as samples (458 records total across
 * grades/échelons): pdf-parse's reading-order text output reproduces the fixed-width table layout
 * faithfully enough that the text parser needs no PDF-specific handling — every record matched an
 * independently-counted "!Bareme :" line, with only one line ever flagged (a genuine encoding
 * glitch present in the source PDF itself, not an extraction artifact).
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  return result.text;
}
