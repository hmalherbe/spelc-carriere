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
// buildHeader). A real campagne-wide export can mean hundreds of recipients, and each batch is
// rendered by Chromium as its own independent PDF document, so pdf-lib's copyPages below carries
// over a distinct copy of that embedded logo per batch into the merged file — this used to be the
// dominant cause of a 49MB PDF for a 571-recipient campagne (~58 batches of 10, arbitrary
// admin-uploaded logo confirmed ~760KB/~1MB base64-inflated), on top of OOM-killing the api process
// outright when the logo wasn't bounded to even one copy per recipient at all. Now that
// mailingBranding.ts's resizeLogo shrinks every uploaded logo down to its real display size at
// upload time (1-2 orders of magnitude smaller), the per-batch duplication this comment used to
// warn about is no longer a real size/memory risk. Batching itself still helps independently of the
// logo (keeps each individual Chromium render's own HTML/DOM small) and is cheap insurance on a box
// this tight on memory (confirmed production host: ~1.9GB total, no swap).
export const MAILING_PDF_BATCH_SIZE = 10;

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
 * one page per section — batched per MAILING_PDF_BATCH_SIZE above rather than in one shot. One browser launch
 * is shared across every batch; only one page/document is held in memory at a time.
 */
export async function renderMailingPdf(letterSections: string[]): Promise<Buffer> {
  const browser = await launchChromium();
  try {
    const merged = await PDFDocument.create();
    for (let i = 0; i < letterSections.length; i += MAILING_PDF_BATCH_SIZE) {
      const batch = letterSections.slice(i, i + MAILING_PDF_BATCH_SIZE);
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
