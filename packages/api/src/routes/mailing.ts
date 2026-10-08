import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { buildPromotionEmail, escapeHtml, type MailingElu, type MailingSocialLink } from "../mailing/template.js";
import { buildCcmaModelEmail, CcmaModelUnavailableError, type CcmaModelContext } from "../mailing/ccmaModelTemplate.js";
import { deriveBonification } from "../mailing/bonification.js";
import { loadDernierPromuBaByGroup, type DernierPromuBa } from "../mailing/dernierPromuBa.js";
import { loadBaCandidateCountByGroup } from "../mailing/baCandidateStats.js";
import { computeFuturePromotion } from "../mailing/futurePromotion.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { sendBrevoEmail, BrevoConfigError, type BrevoConfig } from "../mailing/brevo.js";
import { renderMailingPdf, isFirstOfBatch } from "../mailing/pdf.js";
import { computeBaStatus } from "../baStatus.js";
import { civiliteFromPrenom, normalizeName } from "@spelc/import";
import { decryptSecret } from "../crypto.js";
import { loadMailingBranding } from "../mailingBranding.js";
import type { GrilleCode } from "@spelc/domain";

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

type EligibleRecipient = Awaited<ReturnType<typeof eligibleRecipients>>[number];

/** Everything the CCMA model template needs beyond what the generic template already uses —
 * loaded once per request (campagne-wide or group-wide, not per recipient) so building N letters
 * doesn't mean N queries. */
interface CcmaModelExtras {
  grilles: Awaited<ReturnType<typeof loadLiveGrilles>>;
  valeurDuPoint: number;
  dernierPromuByGroup: Map<string, DernierPromuBa>;
  candidateCountByGroup: Map<string, number>;
}

async function loadCcmaModelExtras(campagneId: string): Promise<CcmaModelExtras> {
  const [grilles, valeurDuPoint, dernierPromuByGroup, candidateCountByGroup] = await Promise.all([
    loadLiveGrilles(),
    loadCurrentValeurDuPoint(),
    loadDernierPromuBaByGroup(campagneId),
    loadBaCandidateCountByGroup(campagneId),
  ]);
  return { grilles, valeurDuPoint, dernierPromuByGroup, candidateCountByGroup };
}

function buildCcmaModelContext(
  recipient: EligibleRecipient,
  campagne: { dateCcma: Date; type: "CCMA" | "CCMI" | null },
  extras: CcmaModelExtras,
  shared: { elus: MailingElu[]; t1Text: string | null; logoDataUrl: string | null; socialLinks: MailingSocialLink[] },
): CcmaModelContext {
  const bonification = deriveBonification(recipient);
  const groupKey = `${recipient.grade}|${recipient.echelonActuel}`;
  const dernierPromu = extras.dernierPromuByGroup.get(groupKey) ?? null;

  const candidateCount = extras.candidateCountByGroup.get(groupKey) ?? 0;
  const pourcentagePromusBa =
    candidateCount > 0 && recipient.nombrePromusBaSection != null
      ? Math.round((recipient.nombrePromusBaSection / candidateCount) * 100)
      : null;

  const future = recipient.dateProchainePromotion
    ? computeFuturePromotion({
        grille: recipient.grilleCode as GrilleCode,
        echelonApresCettePromotion: recipient.echelonSuivant,
        dateEffetCettePromotion: recipient.dateProchainePromotion.toISOString(),
        grilles: extras.grilles,
        valeurDuPoint: extras.valeurDuPoint,
      })
    : { dateFuturePromotion: null, dateFuturePromotionSiBA: null };

  return {
    civilite: recipient.civilite,
    prenom: recipient.prenom,
    nom: recipient.nom,
    email: recipient.email,
    isAdherent: recipient.isAdherent,
    commission: (campagne.type ?? "CCMA") as "CCMA" | "CCMI",
    elus: shared.elus,
    t1Text: shared.t1Text,
    logoDataUrl: shared.logoDataUrl,
    socialLinks: shared.socialLinks,
    dateCcma: campagne.dateCcma.toISOString(),
    grade: recipient.grade,
    echelonDepart: recipient.echelonDepart,
    echelonSuivant: recipient.echelonSuivant,
    gainSalaireNet: recipient.gainSalaireNet,
    dateAccesEchelonActuel: recipient.dateAccesEchelon.toISOString(),
    dateEffetCcm: recipient.dateProchainePromotion ? recipient.dateProchainePromotion.toISOString() : null,
    typePromotion: recipient.typePromotion,
    dureeRestanteEncoded: recipient.dureeRestante,
    bonification,
    // Only meaningful when this cycle was actually BA-related (bonification !== "ANCIENNETE",
    // computed above via the same rule as deriveBonification — checking typePromotion alone here
    // missed real BONIFICATION cases where the base marker says "AN" but proTypePromotion is the
    // pending/confirmed "BA" decision). The rectorat's "Pro TYPE.date" marker fires for plain AN/CL
    // confirmations too (see MOLENAT Marion, a "RE." report-d'ancienneté record confirmed "Pro AN."
    // — her dateProchainePromotionRectorat is set but has nothing to do with a bonification).
    dateEligibiliteBA:
      bonification !== "ANCIENNETE" && recipient.dateProchainePromotionRectorat
        ? recipient.dateProchainePromotionRectorat.toISOString()
        : null,
    pourcentagePromusBa,
    bareme: recipient.avisEvaluation,
    ancienneteGrade: recipient.ancienneteGrade,
    ancienneteEchelon: recipient.ancienneteEchelon,
    dernierPromu,
    dateFuturePromotion: future.dateFuturePromotion,
    dateFuturePromotionSiBA: future.dateFuturePromotionSiBA,
  };
}

/** Builds one recipient's letter under the chosen template — the exact same content whether it's
 * about to be sent (/send), previewed (/preview), or exported to a read-only PDF archive (/pdf), so
 * all three routes share this instead of each re-deriving the ternary. */
function buildRecipientEmail(
  recipient: EligibleRecipient,
  campagne: { anneeScolaire: string; dateCcma: Date; type: "CCMA" | "CCMI" | null },
  template: "generique" | "ccma_avancement",
  shared: { elus: MailingElu[]; t1Text: string | null; logoDataUrl: string | null; socialLinks: MailingSocialLink[] },
  ccmaExtras: CcmaModelExtras | null,
): { subject: string; html: string } {
  if (template === "ccma_avancement" && ccmaExtras) {
    // Callers only ever pass ccmaExtras when campagne.type === "CCMA" (see loadCcmaModelExtras's
    // call sites below) — TS doesn't narrow the enclosing object's type from that, so restate it.
    return buildCcmaModelEmail(buildCcmaModelContext(recipient, { ...campagne, type: "CCMA" as const }, ccmaExtras, shared));
  }
  return buildPromotionEmail({
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
    elus: shared.elus,
    t1Text: shared.t1Text,
    logoDataUrl: shared.logoDataUrl,
    socialLinks: shared.socialLinks,
  });
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
    grilleCode: string;
    email: string | null;
    lastStatus: string | null;
    lastSentAt: Date | null;
    lastError: string | null;
    // Raw fields only needed by the CCMA model template (see ccmaModelTemplate.ts) — the generic
    // template ignores all of these.
    echelonActuel: string;
    dateAccesEchelon: Date;
    typePromotion: string | null;
    dureeRestante: string | null;
    proTypePromotion: string | null;
    proConfirmee: boolean;
    dateProchainePromotionRectorat: Date | null;
    nombrePromusBaSection: number | null;
    avisEvaluation: number | null;
    ancienneteGrade: number | null;
    ancienneteEchelon: number | null;
    // Même règle que la colonne "Éligibilité BA" de DashboardPage (voir baStatus.ts) — affichée ici
    // aussi, après la colonne "Échelon" (voir MailingPage.tsx).
    baStatus: "hors_fenetre" | "national" | "promu" | "non_promu" | null;
    baEchelonDepart: 6 | 8 | null;
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
    // rather than second-guessed from their prénom. Either one can be overridden by hand from the
    // Mailing page itself (Teacher.civiliteCorrigee's own doc comment) — when set, it always wins
    // and is never flagged "estimé" (it's a deliberate choice, not a guess).
    const civilite = teacher.civiliteCorrigee ?? (isAdherent ? (adherent?.civilite ?? null) : civiliteFromPrenom(prenom));
    const civiliteEstimee = !teacher.civiliteCorrigee && !isAdherent && civilite != null;
    const email = adherent
      ? adherent.mailPersonnel
      : (academicEmailByName.get(`${normalizeName(snap.nomUsage)}|${normalizeName(snap.prenom)}`) ?? null);

    const log = logByTeacherId.get(teacher.id) ?? null;
    const { baStatus, baEchelonDepart } = computeBaStatus({
      echelonActuel: snap.echelonActuel,
      grade: snap.grade,
      proTypePromotion: snap.proTypePromotion,
      proConfirmee: snap.proConfirmee,
      ancienneteEchelon: snap.ancienneteEchelon,
    });
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
      grilleCode: state.grilleCode,
      email,
      lastStatus: log?.status ?? null,
      lastSentAt: log?.sentAt ?? null,
      lastError: log?.error ?? null,
      echelonActuel: snap.echelonActuel,
      dateAccesEchelon: snap.dateAccesEchelon,
      typePromotion: snap.typePromotion,
      dureeRestante: snap.dureeRestante,
      proTypePromotion: snap.proTypePromotion,
      proConfirmee: snap.proConfirmee,
      dateProchainePromotionRectorat: snap.dateProchainePromotionRectorat,
      nombrePromusBaSection: snap.nombrePromusBaSection,
      avisEvaluation: snap.avisEvaluation,
      ancienneteGrade: snap.ancienneteGrade,
      ancienneteEchelon: snap.ancienneteEchelon,
      baStatus,
      baEchelonDepart,
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
  const template = req.query.template === "ccma_avancement" ? "ccma_avancement" : "generique";
  if (!campagneId || !teacherId) return res.status(400).json({ error: "campagneId et teacherId requis" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });
  // This route (and eligibleRecipients below) is built entirely around échelon-advancement
  // campagnes (CCMA/CCMI) — a Hors Classe/Classe exceptionnelle campagne has no
  // ComputedPromotionState to read from and needs its own dedicated mailing, not this one.
  if (campagne.type === "HC" || campagne.type === "EXC") {
    return res.status(400).json({ error: "Le mailing d'avancement d'échelon ne s'applique pas aux campagnes Hors Classe / Classe exceptionnelle." });
  }

  const recipient = (await eligibleRecipients(campagneId)).find((r) => r.teacherId === teacherId);
  if (!recipient) return res.status(404).json({ error: "Destinataire introuvable ou non éligible pour cette campagne" });

  const [branding, elusByCommission, socialLinks] = await Promise.all([
    loadMailingBranding(),
    loadElusByCommission(),
    loadSocialLinks(),
  ]);
  const shared = { elus: campagne.type ? elusByCommission[campagne.type] : [], t1Text: branding.t1Text, logoDataUrl: branding.logoDataUrl, socialLinks };

  let email: { subject: string; html: string };
  if (template === "ccma_avancement") {
    if (campagne.type !== "CCMA") {
      return res.status(400).json({ error: "Le modèle CCMA n'est disponible que pour une campagne de type CCMA." });
    }
    try {
      const extras = await loadCcmaModelExtras(campagneId);
      // Guard above already proved campagne.type === "CCMA" at runtime — TS doesn't narrow the
      // enclosing object's type from a property-only check, so state it explicitly here.
      email = buildCcmaModelEmail(buildCcmaModelContext(recipient, { ...campagne, type: "CCMA" as const }, extras, shared));
    } catch (e) {
      if (e instanceof CcmaModelUnavailableError) return res.status(400).json({ error: e.message });
      throw e;
    }
  } else {
    email = buildPromotionEmail({
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
      elus: shared.elus,
      t1Text: shared.t1Text,
      logoDataUrl: shared.logoDataUrl,
      socialLinks: shared.socialLinks,
    });
  }
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

const updateCiviliteSchema = z.object({ civilite: z.enum(["M", "Mme"]).nullable() });

/**
 * Sets or clears a teacher's civilité override (Teacher.civiliteCorrigee's own doc comment) — for
 * when the adhérent-declared value is wrong, or the prénom-based guess for a non-adhérent is wrong
 * or came back empty. null clears the override, reverting to the normal adhérent/guessed behavior.
 * No ComputedPromotionState recompute needed (unlike the ancienneté corrections in routes/
 * teachers.ts) — civilité only ever affects mailing display, never a salary/date calculation.
 */
mailingRouter.put("/:teacherId/civilite", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = updateCiviliteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const teacher = await prisma.teacher.findUnique({ where: { id: req.params.teacherId } });
  if (!teacher) return res.status(404).json({ error: "Enseignant introuvable" });

  await prisma.teacher.update({ where: { id: req.params.teacherId }, data: { civiliteCorrigee: parsed.data.civilite } });
  res.json({ civilite: parsed.data.civilite });
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
  template: z.enum(["generique", "ccma_avancement"]).optional(),
});

mailingRouter.post("/send", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { campagneId, teacherIds, template = "generique" } = parsed.data;

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });
  // This route (and eligibleRecipients below) is built entirely around échelon-advancement
  // campagnes (CCMA/CCMI) — a Hors Classe/Classe exceptionnelle campagne has no
  // ComputedPromotionState to read from and needs its own dedicated mailing, not this one.
  if (campagne.type === "HC" || campagne.type === "EXC") {
    return res.status(400).json({ error: "Le mailing d'avancement d'échelon ne s'applique pas aux campagnes Hors Classe / Classe exceptionnelle." });
  }

  if (template === "ccma_avancement" && campagne.type !== "CCMA") {
    return res.status(400).json({ error: "Le modèle CCMA n'est disponible que pour une campagne de type CCMA." });
  }

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
  const shared = { elus: campagne.type ? elusByCommission[campagne.type] : [], t1Text: branding.t1Text, logoDataUrl: branding.logoDataUrl, socialLinks };
  const ccmaExtras = template === "ccma_avancement" ? await loadCcmaModelExtras(campagneId) : null;

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

    const { subject, html } = buildRecipientEmail(recipient, { ...campagne, type: campagne.type as "CCMA" | "CCMI" | null }, template, shared, ccmaExtras);
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

const pdfSchema = z.object({
  campagneId: z.string().min(1),
  teacherIds: z.array(z.string()).min(1),
  template: z.enum(["generique", "ccma_avancement"]).optional(),
});

/**
 * One PDF with one page per selected recipient's letter — the exact content /send would e-mail
 * them (via buildRecipientEmail, shared with that route), for an admin to archive or proofread
 * offline. Purely a read-only export: unlike /send, it never touches MailingLog and is completely
 * unaffected by test mode (the "À :" line always shows the real address on file, never the test
 * redirect — this file is meant to show what WOULD be sent, not what test mode did with it).
 */
mailingRouter.post("/pdf", requireRole("ADMIN", "GESTIONNAIRE"), asyncHandler(async (req, res) => {
  const parsed = pdfSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
  }
  const { campagneId, teacherIds, template = "generique" } = parsed.data;

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });
  if (campagne.type === "HC" || campagne.type === "EXC") {
    return res.status(400).json({ error: "Le mailing d'avancement d'échelon ne s'applique pas aux campagnes Hors Classe / Classe exceptionnelle." });
  }
  if (template === "ccma_avancement" && campagne.type !== "CCMA") {
    return res.status(400).json({ error: "Le modèle CCMA n'est disponible que pour une campagne de type CCMA." });
  }

  const all = await eligibleRecipients(campagneId);
  const targets = all.filter((r) => teacherIds.includes(r.teacherId));
  if (targets.length === 0) return res.status(400).json({ error: "Aucun destinataire sélectionné." });

  const [branding, elusByCommission, socialLinks] = await Promise.all([
    loadMailingBranding(),
    loadElusByCommission(),
    loadSocialLinks(),
  ]);
  const shared = { elus: campagne.type ? elusByCommission[campagne.type] : [], t1Text: branding.t1Text, logoDataUrl: branding.logoDataUrl, socialLinks };
  const ccmaExtras = template === "ccma_avancement" ? await loadCcmaModelExtras(campagneId) : null;

  const pages = targets.map((recipient, index) => {
    // The branding logo is a real, non-trivial image (confirmed ~760KB in production) that
    // buildHeader embeds inline on every letter — fine for one self-contained e-mail, but
    // multiplied across a whole campagne's worth of recipients in this one PDF it's what OOM-
    // killed the api process (see pdf.ts's own comment). Keeping it only on the first page of each
    // batch bounds that duplication regardless of how many recipients are selected.
    const recipientShared = isFirstOfBatch(index) ? shared : { ...shared, logoDataUrl: null };
    const { subject, html } = buildRecipientEmail(
      recipient,
      { ...campagne, type: campagne.type as "CCMA" | "CCMI" | null },
      template,
      recipientShared,
      ccmaExtras,
    );
    const to = recipient.email ?? "aucune adresse connue";
    return `<section style="page-break-after: always;">
        <p style="font-size: 0.75rem; color: #666666; border-bottom: 1px solid #cccccc; padding-bottom: 8px; margin-bottom: 16px;">
          À : ${escapeHtml(to)} — Sujet : ${escapeHtml(subject)}
        </p>
        ${html}
      </section>`;
  });

  const pdf = await renderMailingPdf(pages);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="mailing-${campagne.anneeScolaire}.pdf"`);
  res.send(pdf);
}));
