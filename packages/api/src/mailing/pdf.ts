import { chromium } from "playwright";

/**
 * Renders one HTML document to a PDF buffer via headless Chromium — the same engine already
 * bundled in this image for the ADEL scraper (see packages/scraper/src/adelScraper.ts and this
 * image's Dockerfile, which installs it with --with-deps), so no extra deployment step is needed.
 * CSS `page-break-after` in the source HTML becomes real PDF page breaks, which is how
 * buildMailingPdf (routes/mailing.ts) gets "one page per notification" out of a single render.
 *
 * PLAYWRIGHT_CHROMIUM_PATH is an escape hatch for a dev box whose pre-installed browser revision
 * doesn't match this package's pinned playwright version (same idea as adelScraper.ts's own
 * optional config.executablePath) — unset in production, where the Dockerfile's own
 * `playwright install` already matches the two.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
