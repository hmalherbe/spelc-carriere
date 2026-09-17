import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { encryptSecret } from "../crypto.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const SINGLETON_ID = "singleton";

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
