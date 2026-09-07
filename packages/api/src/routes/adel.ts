import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { importAdherentRecords } from "../adherentImport.js";
import { parseAdherentXlsx } from "@spelc/import";
import { scrapeAdelExport, type AdelSyncType } from "@spelc/scraper";

export const adelRouter = Router();
adelRouter.use(requireAuth);

class AdelConfigError extends Error {}

function loadAdelConfig() {
  const loginUrl = process.env.ADEL_URL;
  const username = process.env.ADEL_USERNAME;
  const password = process.env.ADEL_PASSWORD;
  if (!loginUrl || !username || !password) {
    throw new AdelConfigError(
      "Synchronisation ADEL non configurée : définissez ADEL_URL, ADEL_USERNAME et ADEL_PASSWORD (voir README) avant de synchroniser.",
    );
  }
  return { loginUrl, username, password, spelcName: process.env.ADEL_SPELC_NAME ?? "azur" };
}

adelRouter.get("/last", asyncHandler(async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (type !== "CCMA" && type !== "CCMI") return res.status(400).json({ error: "type doit être CCMA ou CCMI" });
  const last = await prisma.adelSyncLog.findFirst({ where: { type }, orderBy: { syncedAt: "desc" } });
  res.json(last);
}));

const syncSchema = z.object({ type: z.enum(["CCMA", "CCMI"]) });

adelRouter.post("/sync", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const type: AdelSyncType = parsed.data.type;

  let config;
  try {
    config = loadAdelConfig();
  } catch (e) {
    if (e instanceof AdelConfigError) return res.status(400).json({ error: e.message });
    throw e;
  }

  try {
    const { buffer } = await scrapeAdelExport(config, type);
    const { records, unmappedFields } = await parseAdherentXlsx(buffer);
    const { created, updated, matching } = await importAdherentRecords(records);

    const log = await prisma.adelSyncLog.create({
      data: { type, status: "SUCCESS", created, updated, triggeredById: req.auth!.userId },
    });

    res.status(201).json({ syncedAt: log.syncedAt, created, updated, unmappedFields, matching });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.adelSyncLog.create({
      data: { type, status: "FAILED", error: message, triggeredById: req.auth!.userId },
    });
    res.status(502).json({ error: `Échec de la synchronisation ADEL : ${message}` });
  }
}));
