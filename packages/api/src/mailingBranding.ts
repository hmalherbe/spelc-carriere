import { prisma } from "./db.js";

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
