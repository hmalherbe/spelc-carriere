import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { GRADE_MAPPINGS, computeReclassementHcExc, type GrilleCode } from "@spelc/domain";
import { civiliteFromPrenom, normalizeName } from "@spelc/import";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { loadMailingBranding } from "../mailingBranding.js";
import { sendBrevoEmail, BrevoConfigError } from "../mailing/brevo.js";
import { buildHcExcResultatEmail, type HcExcResultatContext } from "../mailing/hcExcResultatTemplate.js";
import { buildHcExcReclassementEmail, type HcExcReclassementContext } from "../mailing/hcExcReclassementTemplate.js";
import { loadBrevoConfigFromDb, loadElusByCommission, loadSocialLinks, buildRecipientUnsubscribeUrl } from "./mailing.js";
import { escapeHtml, htmlToPlainText, type MailingElu, type MailingSocialLink } from "../mailing/template.js";
import { renderMailingPdf } from "../mailing/pdf.js";
import { decisionEffective } from "../hcExcComputation.js";

export const hcExcMailingRouter = Router();
hcExcMailingRouter.use(requireAuth);

function gradeToGrille(grade: string): GrilleCode | null {
  const mapping = GRADE_MAPPINGS.find((g) => g.grade === grade);
  return (mapping?.grille as GrilleCode | undefined) ?? null;
}

/** Lookup inverse de gradeToGrille — le libellé de grade affiché pour la grille D'ARRIVÉE après
 * un reclassement (ex. "HC_PROFS" -> "CERTIFIE HC" ne suffit pas à lui seul puisque plusieurs
 * grades premier/second degré partagent la même grille HC_PROFS — mais GRADE_MAPPINGS n'a qu'une
 * entrée par grille pour ce cas, donc on prend la première correspondance, suffisant pour
 * l'affichage d'une lettre). */
function grilleToGradeLabel(grille: GrilleCode): string {
  return GRADE_MAPPINGS.find((g) => g.grille === grille)?.grade ?? grille;
}

function estAgrege(grade: string): boolean {
  return grade.toUpperCase().startsWith("AGREGE");
}

/** Date d'effet de la promotion annoncée dans la lettre : le 1er septembre de l'année scolaire qui
 * SUIT celle évaluée par la campagne (periodeFin + 1 jour), jamais periodeDebut — periodeDebut est
 * le début de l'année scolaire ÉVALUÉE par la CCMA (ex. 01/09/2024 pour la campagne 2024-2025),
 * antérieure à la CCMA elle-même et donc fausse comme date d'effet. Bug réel trouvé le 2026-11-02 en
 * comparant un mailing réel au classeur Excel de l'ancienne application : toutes les lettres
 * "promu(e)" annonçaient le 01/09/2024 (avant la CCMA du 12 juin 2025) au lieu du 01/09/2025 attendu. */
function dateEffetPromotion(periodeFin: Date): string {
  return new Date(periodeFin.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

interface ResultatRow {
  hcExcSnapshotId: string;
  teacherId: string;
  adherentId: string | null;
  isAdherent: boolean;
  nom: string;
  prenom: string;
  civilite: string | null;
  civiliteEstimee: boolean;
  grade: string;
  rang: number;
  vivier: string | null;
  /** Nombre de fiches décidées promues dans le même (grade, vivier) — voir decisionEffective,
   * calculé une fois par groupe ci-dessous, jamais saisi à la main. */
  nombrePromus: number;
  choixRecteur: boolean;
  decisionManuelle: boolean | null;
  /** Décision effective affichée dans la lettre (decisionManuelle si renseignée, sinon choixRecteur
   * — voir decisionEffective). */
  promu: boolean;
  appreciationRecteur: string | null;
  pointsRecteur: number | null;
  pointsAnciennete: number | null;
  totalBareme: number | null;
  echelonActuel: string;
  ancienneteEchelon: number | null;
  email: string | null;
  lastStatus: string | null;
  optedOut: boolean;
}

/** Tous les enseignants d'une campagne HC/EXC, rapprochés adhérent↔enseignant exactement comme
 * eligibleRecipients (routes/mailing.ts) le fait pour l'échelon — même logique de résolution
 * d'adresse/civilité, lue depuis HcExcSnapshot plutôt que TeacherSnapshot/ComputedPromotionState.
 * `promu` (voir decisionEffective) décide la phrase promu/non-promu de la lettre — modifiable par
 * fiche depuis l'onglet Mailing (PATCH /hc-exc/:id/decision), sans quoi elle suit le marqueur
 * "Choix du Recteur" du fichier rectorat.
 */
async function resultatRecipients(campagneId: string): Promise<{ campagne: NonNullable<Awaited<ReturnType<typeof findCampagne>>>; rows: ResultatRow[] } | null> {
  const campagne = await findCampagne(campagneId);
  if (!campagne) return null;

  const snapshots = await prisma.hcExcSnapshot.findMany({
    where: { campagneId },
    include: { teacher: { include: { matchCandidate: { include: { adherent: true } } } } },
    orderBy: [{ grade: "asc" }, { vivier: "asc" }, { rang: "asc" }],
  });

  // Nombre de promus par (grade, vivier) — calculé une seule fois ici à partir des décisions
  // effectives déjà chargées ci-dessus, plutôt qu'un contingent saisi à la main (voir
  // HcExcSnapshot.decisionManuelle's own doc comment).
  const nombrePromusByGroup = new Map<string, number>();
  for (const snap of snapshots) {
    if (!decisionEffective(snap)) continue;
    const key = `${snap.grade}|${snap.vivier ?? ""}`;
    nombrePromusByGroup.set(key, (nombrePromusByGroup.get(key) ?? 0) + 1);
  }

  const academicEmails = await prisma.academicEmail.findMany();
  const academicEmailByName = new Map<string, string>();
  for (const a of academicEmails) {
    const key = `${normalizeName(a.nom)}|${normalizeName(a.prenom)}`;
    if (!academicEmailByName.has(key)) academicEmailByName.set(key, a.email);
  }

  const logs = await prisma.mailingLog.findMany({ where: { campagneId, kind: "RESULTAT" } });
  const logByTeacherId = new Map(logs.map((l) => [l.teacherId, l]));

  const optOuts = await prisma.mailingOptOut.findMany();
  const optedOutEmails = new Set(optOuts.filter((o) => o.email).map((o) => o.email!));
  const optedOutNameKeys = new Set(optOuts.filter((o) => o.nom && o.prenom).map((o) => `${normalizeName(o.nom!)}|${normalizeName(o.prenom!)}`));
  function isOptedOut(email: string | null, nom: string, prenom: string): boolean {
    if (email && optedOutEmails.has(email.trim().toLowerCase())) return true;
    return optedOutNameKeys.has(`${normalizeName(nom)}|${normalizeName(prenom)}`);
  }

  const seenTeacherIds = new Set<string>();
  const rows: ResultatRow[] = [];

  for (const snap of snapshots) {
    const teacher = snap.teacher;
    if (seenTeacherIds.has(teacher.id)) continue; // un double import pourrait laisser >1 fiche pour le même enseignant
    seenTeacherIds.add(teacher.id);

    const candidate = teacher.matchCandidate;
    const isAdherentReel = candidate != null && (candidate.status === "AUTO_CONFIRMED" || candidate.status === "CONFIRMED");
    const isAdherent = teacher.isAdherentCorrige ?? isAdherentReel;
    const adherent = isAdherentReel ? candidate!.adherent : null;
    const nom = adherent?.nom ?? snap.nomUsage;
    const prenom = adherent?.prenom ?? snap.prenom;
    const civilite = teacher.civiliteCorrigee ?? (isAdherentReel ? (adherent?.civilite ?? null) : civiliteFromPrenom(prenom));
    const civiliteEstimee = !teacher.civiliteCorrigee && !isAdherentReel && civilite != null;
    const email = adherent ? adherent.mailPersonnel : (academicEmailByName.get(`${normalizeName(snap.nomUsage)}|${normalizeName(snap.prenom)}`) ?? null);
    const log = logByTeacherId.get(teacher.id) ?? null;
    const groupKey = `${snap.grade}|${snap.vivier ?? ""}`;

    rows.push({
      hcExcSnapshotId: snap.id,
      teacherId: teacher.id,
      adherentId: adherent?.id ?? null,
      isAdherent,
      nom,
      prenom,
      civilite,
      civiliteEstimee,
      grade: snap.grade,
      rang: snap.rang,
      vivier: snap.vivier,
      nombrePromus: nombrePromusByGroup.get(groupKey) ?? 0,
      choixRecteur: snap.choixRecteur,
      decisionManuelle: snap.decisionManuelle,
      promu: decisionEffective(snap),
      appreciationRecteur: snap.appreciationRecteur,
      pointsRecteur: snap.pointsRecteur,
      pointsAnciennete: snap.pointsAnciennete,
      totalBareme: snap.totalBareme,
      echelonActuel: snap.echelonActuel,
      ancienneteEchelon: snap.ancienneteEchelon,
      email,
      lastStatus: log?.status ?? null,
      optedOut: !isAdherentReel && isOptedOut(email, nom, prenom),
    });
  }

  return { campagne, rows };
}

interface ReclassementRow extends ResultatRow {
  nouveauGrade: string;
  nouvelEchelon: string;
  ancienneteReporteeJours: number;
  gainSalaireNet: number;
  dateProchainePromotion: string | null;
}

/** Sous-ensemble de resultatRecipients : seulement les adhérents effectivement promus (voir
 * ResultatRow.promu's own doc comment — decisionManuelle si renseignée, sinon choixRecteur), avec
 * leur reclassement calculé via computeReclassementHcExc (déjà vérifié
 * exhaustivement contre le classeur réel du syndicat dans cette même session). Silencieusement
 * exclu (pas une erreur bloquante) quand la grille d'origine ou l'ancienneté dans l'échelon
 * manquent pour calculer — même esprit que computeEtStockerBaremeExc's `nonCalcules`, à affiner
 * plus tard si besoin d'un signalement explicite. */
async function reclassementRecipients(campagneId: string): Promise<{ campagne: NonNullable<Awaited<ReturnType<typeof findCampagne>>>; rows: ReclassementRow[] } | null> {
  const data = await resultatRecipients(campagneId);
  if (!data) return null;
  const { campagne, rows } = data;

  const [liveGrilles, valeurDuPoint, logs] = await Promise.all([
    loadLiveGrilles(),
    loadCurrentValeurDuPoint(),
    prisma.mailingLog.findMany({ where: { campagneId, kind: "RECLASSEMENT" } }),
  ]);
  const logByTeacherId = new Map(logs.map((l) => [l.teacherId, l]));
  const dateReference = campagne.periodeDebut.toISOString().slice(0, 10);

  const result: ReclassementRow[] = [];
  for (const r of rows) {
    if (!r.isAdherent || !r.promu) continue;
    const grilleActuelle = gradeToGrille(r.grade);
    if (!grilleActuelle || r.ancienneteEchelon == null) continue;

    try {
      const reclassement = computeReclassementHcExc({
        processus: campagne.nature as "HC" | "EXC",
        grilleActuelle,
        echelonActuel: r.echelonActuel,
        ancienneteJoursAuReference: r.ancienneteEchelon * 360,
        dateReference,
        grilles: liveGrilles,
        valeurDuPoint,
      });
      const log = logByTeacherId.get(r.teacherId) ?? null;
      result.push({
        ...r,
        nouveauGrade: grilleToGradeLabel(reclassement.nouvelleGrille),
        nouvelEchelon: String(reclassement.nouvelEchelon),
        ancienneteReporteeJours: reclassement.ancienneteReporteeJours,
        gainSalaireNet: reclassement.gainSalaireNet,
        dateProchainePromotion: reclassement.dateProchainePromotion,
        lastStatus: log?.status ?? null,
      });
    } catch {
      continue; // table de reclassement introuvable pour cette grille/échelon — cas non couvert, pas bloquant pour les autres
    }
  }
  return { campagne, rows: result };
}

async function findCampagne(campagneId: string) {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne || (campagne.nature !== "HC" && campagne.nature !== "EXC")) return null;
  return campagne;
}

hcExcMailingRouter.get(
  "/eligible",
  asyncHandler(async (req, res) => {
    const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
    const kind = req.query.kind === "reclassement" ? "reclassement" : "resultat";
    if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

    const data = kind === "reclassement" ? await reclassementRecipients(campagneId) : await resultatRecipients(campagneId);
    if (!data) return res.status(404).json({ error: "Campagne introuvable ou non HC/EXC" });
    res.json(data.rows);
  }),
);

interface SharedMailingContent {
  elus: MailingElu[];
  t1Text: string | null;
  logoDataUrl: string | null;
  socialLinks: MailingSocialLink[];
}

function buildResultatContext(
  r: ResultatRow,
  campagne: { nature: "HC" | "EXC"; commission: "CCMA" | "CCMI"; dateCcma: Date; periodeFin: Date },
  shared: SharedMailingContent,
  unsubscribeUrl: string | null,
): HcExcResultatContext {
  return {
    civilite: r.civilite,
    prenom: r.prenom,
    nom: r.nom,
    email: r.email,
    isAdherent: r.isAdherent,
    unsubscribeUrl,
    commission: campagne.commission,
    elus: shared.elus,
    t1Text: shared.t1Text,
    logoDataUrl: shared.logoDataUrl,
    socialLinks: shared.socialLinks,
    processus: campagne.nature,
    dateCcma: campagne.dateCcma.toISOString(),
    dateEffet: dateEffetPromotion(campagne.periodeFin),
    grade: r.grade,
    estAgrege: estAgrege(r.grade),
    rang: r.rang,
    nombrePromus: r.nombrePromus,
    appreciationRecteur: r.appreciationRecteur,
    pointsRecteur: r.pointsRecteur,
    promu: r.promu,
    pointsAnciennete: r.pointsAnciennete,
    totalBareme: r.totalBareme,
  };
}

function buildReclassementContext(
  r: ReclassementRow,
  campagne: { commission: "CCMA" | "CCMI"; dateCcma: Date; periodeFin: Date },
  shared: SharedMailingContent,
): HcExcReclassementContext {
  return {
    civilite: r.civilite,
    prenom: r.prenom,
    nom: r.nom,
    email: r.email,
    isAdherent: r.isAdherent,
    unsubscribeUrl: null, // jamais pour le reclassement — réservé aux adhérents
    commission: campagne.commission,
    elus: shared.elus,
    t1Text: shared.t1Text,
    logoDataUrl: shared.logoDataUrl,
    socialLinks: shared.socialLinks,
    dateCcma: campagne.dateCcma.toISOString(),
    dateEffet: dateEffetPromotion(campagne.periodeFin),
    nouveauGrade: r.nouveauGrade,
    nouvelEchelon: r.nouvelEchelon,
    ancienneteReporteeJours: r.ancienneteReporteeJours,
    gainSalaireNet: r.gainSalaireNet,
    dateProchainePromotion: r.dateProchainePromotion,
  };
}

function flattenElus<T>(byCommission: Record<"CCMA" | "CCMI", T[]>, commission: "CCMA" | "CCMI"): T[] {
  return byCommission[commission];
}

async function loadShared(commission: "CCMA" | "CCMI" | null) {
  const [branding, elusByCommission, socialLinks] = await Promise.all([loadMailingBranding(), loadElusByCommission(), loadSocialLinks()]);
  return {
    elus: commission ? flattenElus(elusByCommission, commission) : [],
    t1Text: branding.t1Text,
    logoDataUrl: branding.logoDataUrl,
    socialLinks,
  };
}

hcExcMailingRouter.get(
  "/preview",
  asyncHandler(async (req, res) => {
    const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
    const teacherId = typeof req.query.teacherId === "string" ? req.query.teacherId : undefined;
    const kind = req.query.kind === "reclassement" ? "reclassement" : "resultat";
    if (!campagneId || !teacherId) return res.status(400).json({ error: "campagneId et teacherId requis" });

    if (kind === "reclassement") {
      const data = await reclassementRecipients(campagneId);
      if (!data) return res.status(404).json({ error: "Campagne introuvable ou non HC/EXC" });
      const r = data.rows.find((x) => x.teacherId === teacherId);
      if (!r) return res.status(404).json({ error: "Destinataire introuvable ou non éligible au reclassement" });
      if (!data.campagne.commission) return res.status(400).json({ error: "Campagne non scopée par commission (CCMA/CCMI)" });
      const shared = await loadShared(data.campagne.commission);
      const { subject, html } = buildHcExcReclassementEmail(buildReclassementContext(r, { ...data.campagne, commission: data.campagne.commission }, shared));
      return res.json({ to: r.email, subject, html });
    }

    const data = await resultatRecipients(campagneId);
    if (!data) return res.status(404).json({ error: "Campagne introuvable ou non HC/EXC" });
    const r = data.rows.find((x) => x.teacherId === teacherId);
    if (!r) return res.status(404).json({ error: "Destinataire introuvable ou non éligible" });
    if (!data.campagne.commission) return res.status(400).json({ error: "Campagne non scopée par commission (CCMA/CCMI)" });
    const shared = await loadShared(data.campagne.commission);
    const unsubscribeUrl = buildRecipientUnsubscribeUrl(r);
    const { subject, html } = buildHcExcResultatEmail(
      buildResultatContext(r, { ...data.campagne, commission: data.campagne.commission, nature: data.campagne.nature as "HC" | "EXC" }, shared, unsubscribeUrl),
    );
    res.json({ to: r.email, subject, html });
  }),
);

hcExcMailingRouter.get(
  "/log",
  asyncHandler(async (req, res) => {
    const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
    const kind = req.query.kind === "reclassement" ? "RECLASSEMENT" : "RESULTAT";
    if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
    const logs = await prisma.mailingLog.findMany({
      where: { campagneId, kind },
      orderBy: { sentAt: "desc" },
      include: {
        teacher: { include: { hcExcSnapshots: { where: { campagneId }, take: 1 } } },
        events: { orderBy: { occurredAt: "asc" }, select: { type: true, url: true, occurredAt: true } },
      },
    });
    res.json(
      logs.map((log) => {
        const snap = log.teacher.hcExcSnapshots[0];
        return {
          id: log.id,
          email: log.email,
          status: log.status,
          error: log.error,
          sentAt: log.sentAt,
          nom: snap?.nomUsage ?? null,
          prenom: snap?.prenom ?? null,
          events: log.events,
        };
      }),
    );
  }),
);

const sendSchema = z.object({
  campagneId: z.string().min(1),
  kind: z.enum(["resultat", "reclassement"]),
  teacherIds: z.array(z.string()).optional(),
});

hcExcMailingRouter.post(
  "/send",
  requireRole("ADMIN", "GESTIONNAIRE"),
  asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    const { campagneId, kind, teacherIds } = parsed.data;
    const mailingKind = kind === "reclassement" ? "RECLASSEMENT" : "RESULTAT";

    const data = kind === "reclassement" ? await reclassementRecipients(campagneId) : await resultatRecipients(campagneId);
    if (!data) return res.status(404).json({ error: "Campagne introuvable ou non HC/EXC" });
    if (!data.campagne.commission) return res.status(400).json({ error: "Campagne non scopée par commission (CCMA/CCMI)" });
    const commission = data.campagne.commission;

    let brevoConfig;
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

    let targets = teacherIds ? data.rows.filter((r) => teacherIds.includes(r.teacherId)) : data.rows.filter((r) => r.lastStatus !== "SENT");
    const skippedOptedOut = targets.filter((r) => r.optedOut).length;
    targets = targets.filter((r) => !r.optedOut);
    if (testMode && testMaxSends != null) targets = targets.slice(0, testMaxSends);

    if (kind === "resultat" && !process.env.PUBLIC_APP_URL && targets.some((r) => !r.isAdherent && r.email)) {
      return res.status(400).json({
        error: "PUBLIC_APP_URL n'est pas configuré : impossible d'envoyer à des non-adhérents sans lien de désabonnement fonctionnel (voir .env.example).",
      });
    }

    const shared = await loadShared(commission);
    const results: { teacherId: string; nom: string; prenom: string; email: string | null; status: "SENT" | "FAILED"; error?: string }[] = [];

    for (const r of targets) {
      const effectiveEmail = testMode ? testEmail : r.email;
      if (!effectiveEmail) {
        results.push({ teacherId: r.teacherId, nom: r.nom, prenom: r.prenom, email: null, status: "FAILED", error: "Aucune adresse e-mail connue pour cet adhérent" });
        await prisma.mailingLog.upsert({
          where: { campagneId_teacherId_kind: { campagneId, teacherId: r.teacherId, kind: mailingKind } },
          create: { campagneId, teacherId: r.teacherId, adherentId: r.adherentId, email: "", status: "FAILED", kind: mailingKind, error: "Aucune adresse e-mail connue", sentById: req.auth!.userId },
          update: { status: "FAILED", error: "Aucune adresse e-mail connue", sentById: req.auth!.userId, sentAt: new Date() },
        });
        continue;
      }

      const { subject, html } =
        kind === "reclassement"
          ? buildHcExcReclassementEmail(buildReclassementContext(r as ReclassementRow, { ...data.campagne, commission }, shared))
          : buildHcExcResultatEmail(
              buildResultatContext(
                r,
                { ...data.campagne, commission, nature: data.campagne.nature as "HC" | "EXC" },
                shared,
                buildRecipientUnsubscribeUrl(r),
              ),
            );
      const effectiveSubject = testMode
        ? `[TEST — destinataire réel : ${r.nom} ${r.prenom} <${r.email ?? "aucune adresse"}>] ${subject}`
        : subject;

      try {
        const { messageId } = await sendBrevoEmail(brevoConfig, {
          to: { email: effectiveEmail, name: testMode ? `${r.prenom} ${r.nom} (test)` : `${r.prenom} ${r.nom}` },
          subject: effectiveSubject,
          html,
        });
        if (!testMode) {
          await prisma.mailingLog.upsert({
            where: { campagneId_teacherId_kind: { campagneId, teacherId: r.teacherId, kind: mailingKind } },
            create: { campagneId, teacherId: r.teacherId, adherentId: r.adherentId, email: effectiveEmail, status: "SENT", kind: mailingKind, brevoMessageId: messageId, sentById: req.auth!.userId },
            update: { status: "SENT", error: null, brevoMessageId: messageId, sentById: req.auth!.userId, sentAt: new Date() },
          });
        }
        results.push({ teacherId: r.teacherId, nom: r.nom, prenom: r.prenom, email: effectiveEmail, status: "SENT" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!testMode) {
          await prisma.mailingLog.upsert({
            where: { campagneId_teacherId_kind: { campagneId, teacherId: r.teacherId, kind: mailingKind } },
            create: { campagneId, teacherId: r.teacherId, adherentId: r.adherentId, email: effectiveEmail, status: "FAILED", kind: mailingKind, error: message, sentById: req.auth!.userId },
            update: { status: "FAILED", error: message, sentById: req.auth!.userId, sentAt: new Date() },
          });
        }
        results.push({ teacherId: r.teacherId, nom: r.nom, prenom: r.prenom, email: effectiveEmail, status: "FAILED", error: message });
      }
    }

    res.json({
      sent: results.filter((r) => r.status === "SENT").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      results,
      testMode,
      skippedOptedOut,
    });
  }),
);

const exportSchema = z.object({
  campagneId: z.string().min(1),
  kind: z.enum(["resultat", "reclassement"]),
  teacherIds: z.array(z.string()).min(1),
});

/**
 * Construit les mêmes lettres que /send enverrait (via buildResultatContext/buildReclassementContext,
 * partagés avec cette route), pour un ensemble choisi de destinataires — base commune aux deux
 * exports en lecture ci-dessous (/pdf et /text), même pattern que buildMailingLetters
 * (routes/mailing.ts) pour l'échelon.
 */
async function buildHcExcLetters(
  body: unknown,
): Promise<
  | { status: number; error: string }
  | { campagne: { anneeScolaire: string; dateCcma: Date; commission: "CCMA" | "CCMI" | null; nature: string | null }; letters: { to: string; subject: string; html: string }[] }
> {
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: "Corps de requête invalide" };
  const { campagneId, kind, teacherIds } = parsed.data;

  const data = kind === "reclassement" ? await reclassementRecipients(campagneId) : await resultatRecipients(campagneId);
  if (!data) return { status: 404, error: "Campagne introuvable ou non HC/EXC" };
  if (!data.campagne.commission) return { status: 400, error: "Campagne non scopée par commission (CCMA/CCMI)" };
  const commission = data.campagne.commission;

  const targets = data.rows.filter((r) => teacherIds.includes(r.teacherId));
  if (targets.length === 0) return { status: 400, error: "Aucun destinataire sélectionné." };

  const shared = await loadShared(commission);

  const letters = targets.map((r) => {
    const { subject, html } =
      kind === "reclassement"
        ? buildHcExcReclassementEmail(buildReclassementContext(r as ReclassementRow, { ...data.campagne, commission }, shared))
        : buildHcExcResultatEmail(
            buildResultatContext(r, { ...data.campagne, commission, nature: data.campagne.nature as "HC" | "EXC" }, shared, buildRecipientUnsubscribeUrl(r)),
          );
    return { to: r.email ?? "aucune adresse connue", subject, html };
  });

  return { campagne: data.campagne, letters };
}

function buildHcExcExportFileName(
  campagne: { dateCcma: Date; commission: "CCMA" | "CCMI" | null; nature: string | null },
  kind: "resultat" | "reclassement",
  ext: "pdf" | "txt",
): string {
  const today = new Date().toISOString().slice(0, 10);
  const dateCcma = campagne.dateCcma.toISOString().slice(0, 10);
  const commission = campagne.commission ?? "CCMA";
  const nature = campagne.nature ?? "HC";
  return `${today}_Projet_mailing_${nature}_${kind}_${commission}_${dateCcma}.${ext}`;
}

/** Un PDF, une page par lettre sélectionnée — même contenu que /send enverrait, pour relecture/
 * archivage hors ligne. Jamais touché par le mode test ni par MailingLog (purement en lecture). */
hcExcMailingRouter.post(
  "/pdf",
  requireRole("ADMIN", "GESTIONNAIRE"),
  asyncHandler(async (req, res) => {
    const result = await buildHcExcLetters(req.body);
    if ("error" in result) return res.status(result.status).json({ error: result.error });
    const { campagne, letters } = result;

    const pages = letters.map(
      ({ to, subject, html }) => `<section style="page-break-after: always;">
        <p style="font-size: 0.75rem; color: #666666; border-bottom: 1px solid #cccccc; padding-bottom: 8px; margin-bottom: 16px;">
          À : ${escapeHtml(to)} — Sujet : ${escapeHtml(subject)}
        </p>
        ${html}
      </section>`,
    );

    const pdf = await renderMailingPdf(pages);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${buildHcExcExportFileName(campagne, req.body.kind, "pdf")}"`);
    res.send(pdf);
  }),
);

/** Les mêmes lettres que /pdf, en texte brut — aucun rendu Chromium, quasi instantané. */
hcExcMailingRouter.post(
  "/text",
  requireRole("ADMIN", "GESTIONNAIRE"),
  asyncHandler(async (req, res) => {
    const result = await buildHcExcLetters(req.body);
    if ("error" in result) return res.status(result.status).json({ error: result.error });
    const { campagne, letters } = result;

    const separator = `\n\n${"=".repeat(70)}\n\n`;
    const text = letters.map(({ to, subject, html }) => `À : ${to} — Sujet : ${subject}\n\n${htmlToPlainText(html)}`).join(separator) + "\n";

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${buildHcExcExportFileName(campagne, req.body.kind, "txt")}"`);
    res.send(text);
  }),
);
