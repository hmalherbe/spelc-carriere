import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { renderHtmlToPdf, renderMailingPdf } from "../src/mailing/pdf.js";

describe("renderHtmlToPdf", () => {
  it("renders one PDF page per page-break-after section, each keeping its own text", async () => {
    const html = `<!DOCTYPE html><html><body>
      <section style="page-break-after: always;"><p>Bonjour PRUNIER Laurent</p></section>
      <section style="page-break-after: always;"><p>Bonjour MONTANO Thomas</p></section>
      <section><p>Bonjour GUISLAIN Valerie</p></section>
    </body></html>`;

    const pdf = await renderHtmlToPdf(html);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const parser = new PDFParse({ data: pdf });
    const result = await parser.getText();
    expect(result.total).toBe(3);
    expect(result.pages[0].text).toContain("PRUNIER Laurent");
    expect(result.pages[1].text).toContain("MONTANO Thomas");
    expect(result.pages[2].text).toContain("GUISLAIN Valerie");
  }, 30000);
});

describe("renderMailingPdf", () => {
  it("merges more sections than one batch into a single PDF, in order, each keeping its own text", async () => {
    // 45 sections against the module's own MAILING_PDF_BATCH_SIZE of 10 — enough to span several
    // batches (10+10+10+10+5), the exact scenario (many more recipients than fit in one Chromium
    // render) that OOM-killed the previous single-document implementation in production on a
    // 571-recipient campagne.
    const sections = Array.from({ length: 45 }, (_, i) => `<section style="page-break-after: always;"><p>Destinataire numero ${i}</p></section>`);

    const pdf = await renderMailingPdf(sections);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const parser = new PDFParse({ data: pdf });
    const result = await parser.getText();
    expect(result.total).toBe(45);
    expect(result.pages[0].text).toContain("Destinataire numero 0");
    // Index 20 is the first section of its batch (20 % MAILING_PDF_BATCH_SIZE === 0) — proves the
    // merge preserves order across a batch boundary, not just within one.
    expect(result.pages[20].text).toContain("Destinataire numero 20");
    expect(result.pages[44].text).toContain("Destinataire numero 44");
  }, 60000);
});
