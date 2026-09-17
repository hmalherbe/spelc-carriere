import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { buildPromotionEmail, type MailingElu, type MailingSocialLink } from "../mailing/template.js";
import { sendBrevoEmail, BrevoConfigError, type BrevoConfig } from "../mailing/brevo.js";
import { civiliteFromPrenom, normalizeName } from "@spelc/import";
import { decryptSecret } from "../crypto.js";
import { loadMailingBranding } from "../mailingBranding.js";

const SINGLETON_ID = "singleton";

const ELU_ROLE_ORDER: Record<"TITULAIRE" | "SUPPLEANT", number> = { TITULAIRE: 0, SUPPLEANT: 1 };

/** Every élu, grouped by commission and sorted titulaires-then-suppléants — fetched once per
 * request (send/preview cover many recipients but this content is campaign-wide, not per-person). */
async function loadElusByCommission(): Promise<Record<"CCMA" | "CCMI", MailingElu[]>> {
  const all = await prisma.elu.findMany();
  const byCommission: Record<"CCMA" | "CCMI", MailingElu[]> = { CCMA: [], CCMI: [] };
  for (const e of all) {
    byCommission[e.commission].push({ role: e.role, prenom: e.prenom, nom: e.nom, telephone: e.telephone, email: e.email });
  }
  for (const commission of ["CCMA", "CCMI"] as const) {
    byCommission[commission].sort((a, b) => ELU_ROLE_ORDER[a.role] - ELU_ROLE_ORDER[b.role] || a.nom.localeCompare(b.nom));
  }
  return byCommission;
}

async function loadSocialLinks(): Promise<MailingSocialLink[]> {
  const links = await prisma.socialLink.findMany({ orderBy: { ordre: "asc" } });
  return links.map((l) => ({ label: l.label, url: l.url }));
}

/**
 * The Paramètres screen (routes/settings.ts) lets an admin set/rotate the API key without
 * touching the server's .env — the DB row wins field-by-field, falling back to BREVO_API_KEY /
 * BREVO_SENDER_EMAIL / BREVO_SENDER_NAME so an existing deployment configured only via .env keeps
 * working unchanged (same pattern as routes/adel.ts's loadAdelConfig).
 */
async function loadBrevoConfigFromDb(): Promise<{
  config: BrevoConfig;
  testMode: boolean;
  testEmail: string | null;
  testMaxSends: number | null;
}> {
  const dbConfig = await prisma.brevoConfig.findUnique({ where: { id: SINGLETON_ID } });
  const apiKey = dbConfig?.apiKeyEncrypted ? decryptSecret(dbConfig.apiKeyEncrypted) : process.env.BREVO_API_KEY;
  const senderEmail = dbConfig?.senderEmail || process.env.BREVO_SENDER_EMAIL;
  const senderName = dbConfig?.senderName || process.env.BREVO_SENDER_NAME || "Spelc";
  if (!apiKey || !senderEmail) {
    throw new BrevoConfigError(
      "Envoi de mailing non configuré : renseignez la clé API Brevo dans l'onglet Paramètres (ou les variables BREVO_API_KEY/BREVO_SENDER_EMAIL) avant d'envoyer.",
    );
  }
  return {
    config: { apiKey, senderEmail, senderName },
    testMode: dbConfig?.testMode ?? false,
    testEmail: dbConfig?.testEmail ?? null,
    testMaxSends: dbConfig?.testMaxSends ?? null,
  };
}

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
    /** true when `civilite` was guessed from the prénom (non-adhérent, no declared value) rather
     * than coming from Adherent.civilite — callers must display it as an estimation, not a fact. */
    civiliteEstimee: boolean;
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
    // Only a non-adhérent's civilité is ever guessed — an adhérent's is a declared field (from the
    // ADEL export's Civ. column), left as-is (including null when that field wasn't filled in)
    // rather than second-guessed from their prénom.
    const civilite = isAdherent ? (adherent?.civilite ?? null) : civiliteFromPrenom(prenom);
    const civiliteEstimee = !isAdherent && civilite != null;
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
      civiliteEstimee,
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

  const [branding, elusByCommission, socialLinks] = await Promise.all([
    loadMailingBranding(),
    loadElusByCommission(),
    loadSocialLinks(),
  ]);

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
    isAdherent: recipient.isAdherent,
    commission: campagne.type,
    elus: campagne.type ? elusByCommission[campagne.type] : [],
    t1Text: branding.t1Text,
    logoDataUrl: branding.logoDataUrl,
    socialLinks,
  });
  res.json({ to: recipient.email, ...email });
}));

const updateEmailSchema = z.object({ email: z.string().trim().email() });

/**
 * Manually sets the address used for a teacher who has none on file yet (or corrects a wrong one).
 * Writes to whichever source eligibleRecipients() itself reads for that person, so the change is
 * visible immediately: Adherent.mailPersonnel for an adhérent, AcademicEmail (matched by nom+prénom,
 * same normalizeName key as the lookup) for a non-adhérent — creating that row if none existed yet.
 */
mailingRouter.put("/:teacherId/email", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = updateEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Adresse e-mail invalide", details: parsed.error.flatten() });
  }
  const { email } = parsed.data;

  const teacher = await prisma.teacher.findUnique({
    where: { id: req.params.teacherId },
    include: {
      matchCandidate: { include: { adherent: true } },
      snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" } },
    },
  });
  if (!teacher) return res.status(404).json({ error: "Enseignant introuvable" });

  const candidate = teacher.matchCandidate;
  const isAdherent = candidate != null && (candidate.status === "AUTO_CONFIRMED" || candidate.status === "CONFIRMED");

  if (isAdherent) {
    await prisma.adherent.update({ where: { id: candidate!.adherentId }, data: { mailPersonnel: email } });
  } else {
    const snap = teacher.snapshots[0];
    if (!snap) return res.status(404).json({ error: "Aucune fiche connue pour cet enseignant" });
    // Same normalizeName-based lookup key as eligibleRecipients() above — a plain SQL equality or
    // ILIKE wouldn't match through the accent/case differences that key is built to tolerate.
    const existing = await prisma.academicEmail.findMany();
    const match = existing.find((a) => normalizeName(a.nom) === normalizeName(snap.nomUsage) && normalizeName(a.prenom) === normalizeName(snap.prenom));
    if (match) {
      await prisma.academicEmail.update({ where: { id: match.id }, data: { email } });
    } else {
      await prisma.academicEmail.create({ data: { nom: snap.nomUsage, prenom: snap.prenom, email } });
    }
  }

  res.json({ email });
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

  let brevoConfig: BrevoConfig;
  let testMode: boolean;
  let testEmail: string | null;
  let testMaxSends: number | null;
  try {
    ({ config: brevoConfig, testMode, testEmail, testMaxSends } = await loadBrevoConfigFromDb());
  } catch (e) {
    if (e instanceof BrevoConfigError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (testMode && !testEmail) {
    return res.status(400).json({ error: "Mode test activé mais aucune adresse de test n'est configurée dans Paramètres." });
  }

  const all = await eligibleRecipients(campagneId);
  let targets = teacherIds
    ? all.filter((r) => teacherIds.includes(r.teacherId))
    : all.filter((r) => r.lastStatus !== "SENT");
  if (testMode && testMaxSends != null) targets = targets.slice(0, testMaxSends);

  const [branding, elusByCommission, socialLinks] = await Promise.all([
    loadMailingBranding(),
    loadElusByCommission(),
    loadSocialLinks(),
  ]);

  const results: { teacherId: string; nom: string; prenom: string; email: string | null; status: "SENT" | "FAILED"; error?: string }[] = [];

  for (const recipient of targets) {
    // In test mode every send is redirected to testEmail (validated non-null above), so a
    // recipient with no real address on file becomes sendable too — useful for a full dry run.
    const effectiveEmail = testMode ? testEmail : recipient.email;
    if (!effectiveEmail) {
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
      isAdherent: recipient.isAdherent,
      commission: campagne.type,
      elus: campagne.type ? elusByCommission[campagne.type] : [],
      t1Text: branding.t1Text,
      logoDataUrl: branding.logoDataUrl,
      socialLinks,
    });
    const effectiveSubject = testMode
      ? `[TEST — destinataire réel : ${recipient.nom} ${recipient.prenom} <${recipient.email ?? "aucune adresse"}>] ${subject}`
      : subject;

    try {
      const { messageId } = await sendBrevoEmail(brevoConfig, {
        to: { email: effectiveEmail, name: testMode ? `${recipient.prenom} ${recipient.nom} (test)` : `${recipient.prenom} ${recipient.nom}` },
        subject: effectiveSubject,
        html,
      });
      // A test send is never recorded in MailingLog — it must never be mistaken later for the
      // real campaign to this teacher having already gone out (see the /send filter above, which
      // skips anyone with lastStatus === "SENT").
      if (!testMode) {
        await prisma.mailingLog.upsert({
          where: { campagneId_teacherId: { campagneId, teacherId: recipient.teacherId } },
          create: { campagneId, teacherId: recipient.teacherId, adherentId: recipient.adherentId, email: effectiveEmail, status: "SENT", brevoMessageId: messageId, sentById: req.auth!.userId },
          update: { status: "SENT", error: null, brevoMessageId: messageId, sentById: req.auth!.userId, sentAt: new Date() },
        });
      }
      results.push({ teacherId: recipient.teacherId, nom: recipient.nom, prenom: recipient.prenom, email: effectiveEmail, status: "SENT" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!testMode) {
        await prisma.mailingLog.upsert({
          where: { campagneId_teacherId: { campagneId, teacherId: recipient.teacherId } },
          create: { campagneId, teacherId: recipient.teacherId, adherentId: recipient.adherentId, email: effectiveEmail, status: "FAILED", error: message, sentById: req.auth!.userId },
          update: { status: "FAILED", error: message, sentById: req.auth!.userId, sentAt: new Date() },
        });
      }
      results.push({ teacherId: recipient.teacherId, nom: recipient.nom, prenom: recipient.prenom, email: effectiveEmail, status: "FAILED", error: message });
    }
  }

  const sent = results.filter((r) => r.status === "SENT").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  res.status(201).json({ sent, failed, results, testMode });
}));
