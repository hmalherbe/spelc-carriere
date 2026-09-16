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
