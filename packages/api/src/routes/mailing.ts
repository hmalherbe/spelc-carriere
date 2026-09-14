import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { buildPromotionEmail } from "../mailing/template.js";
import { loadBrevoConfig, sendBrevoEmail, BrevoConfigError } from "../mailing/brevo.js";
import { normalizeName } from "@spelc/import";

export const mailingRouter = Router();
mailingRouter.use(requireAuth);

/**
 * Every teacher with a promotion result for this campagne is a potential recipient — not just
 * adhérents. Per product decision, the address used depends on membership:
 *   - adhérent (their adherent↔enseignant link is AUTO_CONFIRMED or human-CONFIRMED) -> their
 *     personal address (mailPersonnel), never falling back to an academic one;
 *   - non-adhérent (no confirmed link) -> looked up by nom/prénom in AcademicEmail, the académie's
 *     own staff-directory export — the only address we have any hope of knowing for them, since
 *     they never gave the union a personal one. Not found there -> no address, no send.
 */
async function eligibleRecipients(campagneId: string) {
  const snapshots = await prisma.teacherSnapshot.findMany({
    where: { campagneId },
    include: {
      teacher: {
        include: {
          computedStates: { where: { campagneId } },
          matchCandidate: { include: { adherent: true } },
        },
      },
    },
  });

  const academicEmails = await prisma.academicEmail.findMany();
  const academicEmailByName = new Map<string, string>();
  for (const a of academicEmails) {
    const key = `${normalizeName(a.nom)}|${normalizeName(a.prenom)}`;
    if (!academicEmailByName.has(key)) academicEmailByName.set(key, a.email);
  }

  const logs = await prisma.mailingLog.findMany({ where: { campagneId } });
  const logByTeacherId = new Map(logs.map((l) => [l.teacherId, l]));

  const seenTeacherIds = new Set<string>();
  const result: {
    teacherId: string;
    adherentId: string | null;
    isAdherent: boolean;
    nom: string;
    prenom: string;
    civilite: string | null;
    grade: string;
    echelonDepart: string;
    echelonSuivant: string;
    indiceActuel: number;
    futurIndice: number;
    gainSalaireBrut: number;
    gainSalaireNet: number;
    dateProchainePromotion: Date | null;
    email: string | null;
    lastStatus: string | null;
    lastSentAt: Date | null;
    lastError: string | null;
  }[] = [];

  for (const snap of snapshots) {
    const teacher = snap.teacher;
    if (seenTeacherIds.has(teacher.id)) continue; // a duplicate reimport could leave >1 snapshot for the same teacher
    seenTeacherIds.add(teacher.id);

    const state = teacher.computedStates[0];
    if (!state) continue;

    const candidate = teacher.matchCandidate;
    const isAdherent = candidate != null && (candidate.status === "AUTO_CONFIRMED" || candidate.status === "CONFIRMED");

    const adherent = isAdherent ? candidate!.adherent : null;
    const nom = adherent?.nom ?? snap.nomUsage;
    const prenom = adherent?.prenom ?? snap.prenom;
    const civilite = adherent?.civilite ?? null;
    const email = adherent
      ? adherent.mailPersonnel
      : (academicEmailByName.get(`${normalizeName(snap.nomUsage)}|${normalizeName(snap.prenom)}`) ?? null);

    const log = logByTeacherId.get(teacher.id) ?? null;
    result.push({
      teacherId: teacher.id,
      adherentId: adherent?.id ?? null,
      isAdherent,
      nom,
      prenom,
      civilite,
      grade: snap.grade,
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
    });
  }

  return result;
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
