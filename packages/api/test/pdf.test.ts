import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { renderHtmlToPdf } from "../src/mailing/pdf.js";

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
