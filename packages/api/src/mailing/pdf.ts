import { chromium, type Browser } from "playwright";
import { PDFDocument } from "pdf-lib";

const PDF_MARGIN = { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" };

// Docker's default /dev/shm is only 64MB, far below what Chromium wants for its own shared
// memory under load — without this flag Chromium can crash or stall instead of just using disk,
// which is exactly what the single-document /mailing/pdf export used to do in production on a
// large campagne (see renderMailingPdf's own comment). Harmless outside Docker.
const CHROMIUM_LAUNCH_ARGS = ["--disable-dev-shm-usage"];

/** PLAYWRIGHT_CHROMIUM_PATH is an escape hatch for a dev box whose pre-installed browser revision
 * doesn't match this package's pinned playwright version (same idea as adelScraper.ts's own
 * optional config.executablePath) — unset in production, where the Dockerfile's own
 * `playwright install` already matches the two. */
function launchChromium(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: CHROMIUM_LAUNCH_ARGS,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
}

async function renderInBrowser(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({ format: "A4", printBackground: true, margin: PDF_MARGIN });
  } finally {
    await page.close();
  }
}

/**
 * Renders one HTML document to a PDF buffer via headless Chromium — the same engine already
 * bundled in this image for the ADEL scraper (see packages/scraper/src/adelScraper.ts and this
 * image's Dockerfile, which installs it with --with-deps), so no extra deployment step is needed.
 * CSS `page-break-after` in the source HTML becomes real PDF page breaks.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchChromium();
  try {
    return await renderInBrowser(browser, html);
  } finally {
    await browser.close();
  }
}

// Each letter section repeats the org logo inline as a data: URI (see mailing/template.ts's
// buildHeader) — a real campagne-wide export can mean hundreds of recipients, and concatenating
// every one of them into a single HTML document before handing it to Chromium means that logo's
// bytes (easily several hundred KB for an uploaded, unoptimized PNG) get duplicated in memory once
// per recipient with no bound at all. Exactly this — a 571-recipient CCMA campagne's "Générer PDF"
// — OOM-killed the whole api process in production (V8 heap exhausted, not just Chromium's own
// memory). Rendering BATCH_SIZE letters per Chromium call instead keeps peak memory bounded to one
// batch's worth of duplicated image bytes regardless of how many recipients are selected; the
// per-batch PDFs are then stitched together with pdf-lib, which only copies already-compact PDF
// page objects (no HTML/image re-duplication at that step).
const BATCH_SIZE = 20;

function wrapHtmlDocument(bodyHtml: string): string {
  return `<!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; color: #222222; font-size: 0.95rem;">
        ${bodyHtml}
      </body>
    </html>`;
}

/**
 * Renders many independent letter sections (each already its own `<section style="page-break-
 * after: always;">...</section>`, see routes/mailing.ts's /pdf route) into a single merged PDF,
 * one page per section — batched per BATCH_SIZE above rather than in one shot. One browser launch
 * is shared across every batch; only one page/document is held in memory at a time.
 */
export async function renderMailingPdf(letterSections: string[]): Promise<Buffer> {
  const browser = await launchChromium();
  try {
    const merged = await PDFDocument.create();
    for (let i = 0; i < letterSections.length; i += BATCH_SIZE) {
      const batch = letterSections.slice(i, i + BATCH_SIZE);
      const batchPdf = await renderInBrowser(browser, wrapHtmlDocument(batch.join("\n")));
      const batchDoc = await PDFDocument.load(batchPdf);
      const copiedPages = await merged.copyPages(batchDoc, batchDoc.getPageIndices());
      for (const page of copiedPages) merged.addPage(page);
    }
    return Buffer.from(await merged.save());
  } finally {
    await browser.close();
  }
}
