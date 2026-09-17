import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { encryptSecret } from "../crypto.js";
import { loadMailingBranding } from "../mailingBranding.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const SINGLETON_ID = "singleton";
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/**
 * Never includes the password itself — only whether one is set (`hasPassword`) — so it can't leak
 * over the wire or end up cached in the browser. The edit form treats a blank password field as
 * "keep the existing one" (see PUT below), using this flag to explain that to non-admin viewers.
 */
settingsRouter.get(
  "/adel",
  asyncHandler(async (_req, res) => {
    const config = await prisma.adelConfig.findUnique({ where: { id: SINGLETON_ID } });
    res.json({
      loginUrl: config?.loginUrl ?? null,
      username: config?.username ?? null,
      spelcName: config?.spelcName ?? "azur",
      hasPassword: !!config?.passwordEncrypted,
      updatedAt: config?.updatedAt ?? null,
    });
  }),
);

const updateAdelSchema = z.object({
  loginUrl: z.string().url(),
  username: z.string().min(1),
  // Omitted or blank = keep the existing encrypted password rather than clearing it — an admin
  // updating just the username/URL shouldn't have to re-type the password every time.
  password: z.string().min(1).optional(),
  spelcName: z.string().min(1),
});

settingsRouter.put(
  "/adel",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = updateAdelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { loginUrl, username, password, spelcName } = parsed.data;

    const fields = { loginUrl, username, spelcName, updatedById: req.auth!.userId };
    const passwordField = password ? { passwordEncrypted: encryptSecret(password) } : {};

    const config = await prisma.adelConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...fields, ...passwordField },
      update: { ...fields, ...passwordField },
    });

    res.json({
      loginUrl: config.loginUrl,
      username: config.username,
      spelcName: config.spelcName,
      hasPassword: !!config.passwordEncrypted,
      updatedAt: config.updatedAt,
    });
  }),
);

/** Never includes the API key itself — only whether one is set (`hasApiKey`) — same reasoning as /adel above. */
settingsRouter.get(
  "/brevo",
  asyncHandler(async (_req, res) => {
    const config = await prisma.brevoConfig.findUnique({ where: { id: SINGLETON_ID } });
    res.json({
      senderEmail: config?.senderEmail ?? null,
      senderName: config?.senderName ?? "Spelc",
      hasApiKey: !!config?.apiKeyEncrypted,
      testMode: config?.testMode ?? false,
      testEmail: config?.testEmail ?? null,
      testMaxSends: config?.testMaxSends ?? null,
      updatedAt: config?.updatedAt ?? null,
    });
  }),
);

const updateBrevoSchema = z.object({
  senderEmail: z.string().email(),
  senderName: z.string().min(1),
  // Omitted or blank = keep the existing encrypted key rather than clearing it, same as /adel's password.
  apiKey: z.string().min(1).optional(),
  testMode: z.boolean(),
  testEmail: z.string().email().optional().or(z.literal("")),
  testMaxSends: z.number().int().positive().optional(),
});

settingsRouter.put(
  "/brevo",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = updateBrevoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { senderEmail, senderName, apiKey, testMode, testEmail, testMaxSends } = parsed.data;
    if (testMode && !testEmail) {
      return res.status(400).json({ error: "Une adresse de test est requise pour activer le mode test" });
    }

    const fields = {
      senderEmail,
      senderName,
      testMode,
      testEmail: testEmail || null,
      testMaxSends: testMaxSends ?? null,
      updatedById: req.auth!.userId,
    };
    const apiKeyField = apiKey ? { apiKeyEncrypted: encryptSecret(apiKey) } : {};

    const config = await prisma.brevoConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...fields, ...apiKeyField },
      update: { ...fields, ...apiKeyField },
    });

    res.json({
      senderEmail: config.senderEmail,
      senderName: config.senderName,
      hasApiKey: !!config.apiKeyEncrypted,
      testMode: config.testMode,
      testEmail: config.testEmail,
      testMaxSends: config.testMaxSends,
      updatedAt: config.updatedAt,
    });
  }),
);

/**
 * The logo + "t1" text shown at the top of every CCMA/CCMI mailing (see mailing/template.ts).
 * logoDataUrl is the actual image bytes, inlined — see mailingBranding.ts for why.
 */
settingsRouter.get(
  "/mailing-branding",
  asyncHandler(async (_req, res) => {
    const branding = await loadMailingBranding();
    res.json(branding);
  }),
);

const updateT1Schema = z.object({ t1Text: z.string().max(500).optional().or(z.literal("")) });

settingsRouter.put(
  "/mailing-branding",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = updateT1Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    await prisma.mailingBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, t1Text: parsed.data.t1Text || null, updatedById: req.auth!.userId },
      update: { t1Text: parsed.data.t1Text || null, updatedById: req.auth!.userId },
    });
    res.json(await loadMailingBranding());
  }),
);

settingsRouter.post(
  "/mailing-branding/logo",
  requireRole("ADMIN"),
  uploadLogo.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Fichier requis (champ 'file')" });
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Le fichier doit être une image (PNG, JPEG, SVG...)" });
    }
    await prisma.mailingBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, logoData: req.file.buffer, logoContentType: req.file.mimetype, updatedById: req.auth!.userId },
      update: { logoData: req.file.buffer, logoContentType: req.file.mimetype, updatedById: req.auth!.userId },
    });
    res.json(await loadMailingBranding());
  }),
);

settingsRouter.delete(
  "/mailing-branding/logo",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await prisma.mailingBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, updatedById: req.auth!.userId },
      update: { logoData: null, logoContentType: null, updatedById: req.auth!.userId },
    });
    res.json(await loadMailingBranding());
  }),
);

/** Never includes the API key itself — only whether one is set (`hasApiKey`) — same reasoning as /adel above. */
settingsRouter.get(
  "/mistral",
  asyncHandler(async (_req, res) => {
    const config = await prisma.mistralConfig.findUnique({ where: { id: SINGLETON_ID } });
    res.json({
      model: config?.model ?? "mistral-large-latest",
      hasApiKey: !!config?.apiKeyEncrypted,
      updatedAt: config?.updatedAt ?? null,
    });
  }),
);

const updateMistralSchema = z.object({
  model: z.string().min(1),
  // Omitted or blank = keep the existing encrypted key rather than clearing it, same as /adel's password.
  apiKey: z.string().min(1).optional(),
});

settingsRouter.put(
  "/mistral",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = updateMistralSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { model, apiKey } = parsed.data;
    const fields = { model, updatedById: req.auth!.userId };
    const apiKeyField = apiKey ? { apiKeyEncrypted: encryptSecret(apiKey) } : {};

    const config = await prisma.mistralConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...fields, ...apiKeyField },
      update: { ...fields, ...apiKeyField },
    });

    res.json({ model: config.model, hasApiKey: !!config.apiKeyEncrypted, updatedAt: config.updatedAt });
  }),
);

/**
 * One or more social network links shown at the end of every mailing (see mailing/template.ts).
 * No per-row CRUD: the admin edits the whole list at once, so PUT replaces it wholesale — same
 * pattern as the "Emails académiques" import.
 */
settingsRouter.get(
  "/social-links",
  asyncHandler(async (_req, res) => {
    const links = await prisma.socialLink.findMany({ orderBy: { ordre: "asc" } });
    res.json(links);
  }),
);

const socialLinksSchema = z.object({
  links: z.array(z.object({ label: z.string().min(1), url: z.string().url() })).max(20),
});

settingsRouter.put(
  "/social-links",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = socialLinksSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    await prisma.$transaction([
      prisma.socialLink.deleteMany({}),
      prisma.socialLink.createMany({
        data: parsed.data.links.map((l, i) => ({ label: l.label, url: l.url, ordre: i })),
      }),
    ]);
    const links = await prisma.socialLink.findMany({ orderBy: { ordre: "asc" } });
    res.json(links);
  }),
);
