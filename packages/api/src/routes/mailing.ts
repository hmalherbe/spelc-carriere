import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { buildPromotionEmail } from "../mailing/template.js";
import { loadBrevoConfig, sendBrevoEmail, BrevoConfigError } from "../mailing/brevo.js";

export const mailingRouter = Router();
mailingRouter.use(requireAuth);

/**
 * A recipient is eligible once their adherent↔enseignant link has been resolved
 * (AUTO_CONFIRMED or human-CONFIRMED — never REJECTED/PENDING_REVIEW), the promotion engine has
 * produced a result for this campagne, and we have an email address to send to.
 */
async function eligibleRecipients(campagneId: string) {
  const candidates = await prisma.matchCandidate.findMany({
    where: { status: { in: ["AUTO_CONFIRMED", "CONFIRMED"] }, teacherId: { not: null } },
    include: {
      adherent: true,
      teacher: {
        include: {
          computedStates: { where: { campagneId } },
          snapshots: { where: { campagneId }, take: 1 },
        },
      },
    },
  });

  const logs = await prisma.mailingLog.findMany({ where: { campagneId } });
  const logByTeacherId = new Map(logs.map((l) => [l.teacherId, l]));

  return candidates
    .filter((c) => c.teacher && c.teacher.computedStates.length > 0 && c.teacher.snapshots.length > 0)
    .map((c) => {
      const teacher = c.teacher!;
      const state = teacher.computedStates[0];
      const snapshot = teacher.snapshots[0];
      const email = c.adherent.mailPersonnel ?? c.adherent.mailAcademique ?? null;
      const log = logByTeacherId.get(teacher.id) ?? null;
      return {
        teacherId: teacher.id,
        adherentId: c.adherent.id,
        nom: c.adherent.nom,
        prenom: c.adherent.prenom,
        civilite: c.adherent.civilite,
        grade: snapshot.grade,
        echelonDepart: state.echelonDepart,
        echelonSuivant: state.echelonSuivant,
        indiceActuel: state.indiceActuel,
        futurIndice: state.futurIndice,
        gainSalaireBrut: state.gainSalaireBrut,
        gainSalaireNet: state.gainSalaireNet,
        dateProchainePromotion: state.dateProchainePromotion,
        email,
        lastStatus: log?.status ?? null,
        lastSentAt: log?.sentAt ?? null,
        lastError: log?.error ?? null,
      };
    });
}

mailingRouter.get("/eligible", asyncHandler(async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  res.json(await eligibleRecipients(campagneId));
}));

mailingRouter.get("/preview", asyncHandler(async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  const teacherId = typeof req.query.teacherId === "string" ? req.query.teacherId : undefined;
  if (!campagneId || !teacherId) return res.status(400).json({ error: "campagneId et teacherId requis" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const recipient = (await eligibleRecipients(campagneId)).find((r) => r.teacherId === teacherId);
  if (!recipient) return res.status(404).json({ error: "Destinataire introuvable ou non éligible pour cette campagne" });

  const email = buildPromotionEmail({
    civilite: recipient.civilite,
    prenom: recipient.prenom,
    nom: recipient.nom,
    grade: recipient.grade,
    echelonDepart: recipient.echelonDepart,
    echelonSuivant: recipient.echelonSuivant,
    indiceActuel: recipient.indiceActuel,
    futurIndice: recipient.futurIndice,
    gainSalaireBrut: recipient.gainSalaireBrut,
    gainSalaireNet: recipient.gainSalaireNet,
    dateProchainePromotion: recipient.dateProchainePromotion ? recipient.dateProchainePromotion.toISOString() : null,
    anneeScolaire: campagne.anneeScolaire,
  });
  res.json({ to: recipient.email, ...email });
}));

mailingRouter.get("/log", asyncHandler(async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  const logs = await prisma.mailingLog.findMany({
    where: { campagneId },
    orderBy: { sentAt: "desc" },
  });
  res.json(logs);
}));

const sendSchema = z.object({
  campagneId: z.string().min(1),
  teacherIds: z.array(z.string()).optional(),
});

mailingRouter.post("/send", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { campagneId, teacherIds } = parsed.data;

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  let brevoConfig;
  try {
    brevoConfig = loadBrevoConfig();
  } catch (e) {
    if (e instanceof BrevoConfigError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const all = await eligibleRecipients(campagneId);
  const targets = teacherIds
    ? all.filter((r) => teacherIds.includes(r.teacherId))
    : all.filter((r) => r.lastStatus !== "SENT");

  const results: { teacherId: string; nom: string; prenom: string; email: string | null; status: "SENT" | "FAILED"; error?: string }[] = [];

  for (const recipient of targets) {
    if (!recipient.email) {
      results.push({ teacherId: recipient.teacherId, nom: recipient.nom, prenom: recipient.prenom, email: null, status: "FAILED", error: "Aucune adresse e-mail connue pour cet adhérent" });
      await prisma.mailingLog.upsert({
        where: { campagneId_teacherId: { campagneId, teacherId: recipient.teacherId } },
        create: { campagneId, teacherId: recipient.teacherId, adherentId: recipient.adherentId, email: "", status: "FAILED", error: "Aucune adresse e-mail connue", sentById: req.auth!.userId },
        update: { status: "FAILED", error: "Aucune adresse e-mail connue", sentById: req.auth!.userId, sentAt: new Date() },
      });
      continue;
    }

    const { subject, html } = buildPromotionEmail({
      civilite: recipient.civilite,
      prenom: recipient.prenom,
      nom: recipient.nom,
      grade: recipient.grade,
      echelonDepart: recipient.echelonDepart,
      echelonSuivant: recipient.echelonSuivant,
      indiceActuel: recipient.indiceActuel,
      futurIndice: recipient.futurIndice,
      gainSalaireBrut: recipient.gainSalaireBrut,
      gainSalaireNet: recipient.gainSalaireNet,
      dateProchainePromotion: recipient.dateProchainePromotion ? recipient.dateProchainePromotion.toISOString() : null,
      anneeScolaire: campagne.anneeScolaire,
    });

    try {
      const { messageId } = await sendBrevoEmail(brevoConfig, {
        to: { email: recipient.email, name: `${recipient.prenom} ${recipient.nom}` },
        subject,
        html,
      });
      await prisma.mailingLog.upsert({
        where: { campagneId_teacherId: { campagneId, teacherId: recipient.teacherId } },
        create: { campagneId, teacherId: recipient.teacherId, adherentId: recipient.adherentId, email: recipient.email, status: "SENT", brevoMessageId: messageId, sentById: req.auth!.userId },
        update: { status: "SENT", error: null, brevoMessageId: messageId, sentById: req.auth!.userId, sentAt: new Date() },
      });
      results.push({ teacherId: recipient.teacherId, nom: recipient.nom, prenom: recipient.prenom, email: recipient.email, status: "SENT" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.mailingLog.upsert({
        where: { campagneId_teacherId: { campagneId, teacherId: recipient.teacherId } },
        create: { campagneId, teacherId: recipient.teacherId, adherentId: recipient.adherentId, email: recipient.email, status: "FAILED", error: message, sentById: req.auth!.userId },
        update: { status: "FAILED", error: message, sentById: req.auth!.userId, sentAt: new Date() },
      });
      results.push({ teacherId: recipient.teacherId, nom: recipient.nom, prenom: recipient.prenom, email: recipient.email, status: "FAILED", error: message });
    }
  }

  const sent = results.filter((r) => r.status === "SENT").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  res.status(201).json({ sent, failed, results });
}));
