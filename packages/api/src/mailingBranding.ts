import sharp from "sharp";
import { prisma } from "./db.js";

// The logo is only ever displayed at "max-height: 60px; max-width: 220px" (see
// mailing/template.ts's buildHeader) — 2x that for a crisp render on higher-DPI PDF viewers/printers
// is more than enough resolution, however large the originally uploaded file was (confirmed ~760KB
// in production, an arbitrary admin-uploaded PNG never sized or compressed for this use). Resizing
// to actual display size and re-encoding as a palette PNG (far fewer bits per pixel than a
// typical full-color/alpha logo export) routinely shrinks it by 1-2 orders of magnitude, which is
// what makes it safe to embed on every single letter of a campagne-wide PDF export again (see
// routes/mailing.ts) instead of only the first page.
const LOGO_MAX_WIDTH = 440;
const LOGO_MAX_HEIGHT = 120;

/** Resizes and recompresses an uploaded logo (any image/* input sharp can decode, including SVG)
 * down to its real display size, always re-encoded as PNG regardless of the source format. */
export async function resizeLogo(buffer: Buffer): Promise<{ buffer: Buffer; contentType: string }> {
  const resized = await sharp(buffer)
    .resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .png({ palette: true, quality: 80, compressionLevel: 9 })
    .toBuffer();
  return { buffer: resized, contentType: "image/png" };
}

export interface MailingBrandingData {
  t1Text: string | null;
  /** A full `data:image/...;base64,...` URI, or null when no logo is configured — built here so
   * every consumer (Paramètres' preview, and mailing/template.ts's actual e-mail HTML) embeds the
   * exact same bytes, inline, without needing a public URL a recipient's mail client could fetch
   * (see MailingBranding in schema.prisma for why inlining was chosen over serving a URL). */
  logoDataUrl: string | null;
}

const SINGLETON_ID = "singleton";

export async function loadMailingBranding(): Promise<MailingBrandingData> {
  const row = await prisma.mailingBranding.findUnique({ where: { id: SINGLETON_ID } });
  const logoDataUrl =
    row?.logoData && row.logoContentType ? `data:${row.logoContentType};base64,${row.logoData.toString("base64")}` : null;
  return { t1Text: row?.t1Text ?? null, logoDataUrl };
}
