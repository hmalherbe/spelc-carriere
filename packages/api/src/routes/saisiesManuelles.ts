import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { GRADE_MAPPINGS, parseAncienneteText, joursComptablesEntre, computeEchelonPromotion, addCalendarYMD, type GrilleCode } from "@spelc/domain";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { computeBaStatus } from "../baStatus.js";
import { recomputeAndStorePromotionState } from "../promotionState.js";
import { computeTeacherList } from "./teachers.js";

/**
 * "Saisie manuelle" d'un enseignant promouvable oublié par le rectorat (demande du syndicat,
 * 2026-10-29) : le rectorat ne fournit ni fichier ni RectoratImport pour ces fiches, mais
 * TeacherSnapshot.importId est une relation obligatoire — on crée donc, pour chaque saisie, un
 * RectoratImport synthétique (fileName "Saisie manuelle") plutôt que de rendre la colonne
 * nullable, pour que tout le reste du schéma (et toute requête qui joint sur `import`) continue de
 * fonctionner sans cas particulier. C'est aussi ce fileName qui permet de repérer ces fiches
 * ensuite (routes/teachers.ts expose `isManual` sur ce critère) : rien d'autre à faire pour
 * qu'elles apparaissent dans l'onglet "Enseignants" et dans le mailing, qui lisent tous les deux
 * TeacherSnapshot/ComputedPromotionState directement, sans filtrer sur la provenance.
 */
export const saisiesManuellesRouter = Router();
saisiesManuellesRouter.use(requireAuth);

const FILENAME_SAISIE_MANUELLE = "Saisie manuelle";

function validateAncienneteText(value: string | undefined | null, fieldName: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return { ok: true, value: null };
  try {
    parseAncienneteText(trimmed);
  } catch {
    return { ok: false, error: `${fieldName} : format attendu "AAaMMmJJj" (ex. "01a06m00j"), reçu ${JSON.stringify(trimmed)}` };
  }
  return { ok: true, value: trimmed };
}

const createSchema = z.object({
  campagneId: z.string().min(1),
  nom: z.string().min(1),
  prenom: z.string().min(1),
  grade: z.string().min(1),
  echelonActuel: z.string().min(1),
  isAdherent: z.boolean(),
  dateAccesEchelon: z.string().min(1),
  ancienneteADeduire: z.string().optional().nullable(),
  ancienneteAReporter: z.string().optional().nullable(),
  // Décision du gestionnaire sur la BA (bonification d'ancienneté) pour une fiche saisie
  // manuellement — voir le long commentaire plus bas sur pourquoi ceci doit exister : sans fichier
  // rectorat, rien ne peut jamais renseigner proTypePromotion/proConfirmee (TeacherSnapshot) tout
  // seul, et sans eux baStatus (baStatus.ts) reste null pour toujours, même quand baEligible dit
  // oui — c'est exactement ce que le syndicat a signalé (Éligibilité BA vide dans Enseignants et
  // Mailing malgré "éligible" dans Saisies manuelles). N'a de sens que pour un échelon 6 ou 8.
  baDecision: z.enum(["promu", "non_promu"]).optional().nullable(),
});

saisiesManuellesRouter.post(
  "/",
  requireRole("ADMIN", "GESTIONNAIRE"),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }
    const { campagneId, nom, prenom, grade, echelonActuel, isAdherent, dateAccesEchelon, ancienneteADeduire, ancienneteAReporter, baDecision } =
      parsed.data;

    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === grade);
    if (!gradeMapping) return res.status(400).json({ error: `Grade "${grade}" non reconnu` });

    const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
    if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

    const dateAcces = new Date(dateAccesEchelon);
    if (Number.isNaN(dateAcces.getTime())) return res.status(400).json({ error: "Date de l'échelon actuel invalide" });

    const deduire = validateAncienneteText(ancienneteADeduire, "Ancienneté à déduire");
    if (!deduire.ok) return res.status(400).json({ error: deduire.error });
    const reporter = validateAncienneteText(ancienneteAReporter, "Ancienneté à reporter");
    if (!reporter.ok) return res.status(400).json({ error: reporter.error });

    // Ancienneté dans l'échelon (années) : le rectorat la fournit lui-même (champ "Z1ANEC") pour
    // une fiche importée, mais une saisie manuelle n'a par construction aucune donnée rectorat —
    // on l'approxime donc par le temps écoulé depuis la date d'accès à l'échelon jusqu'à
    // aujourd'hui (date de la saisie), sur le même calendrier bancaire (360 jours/an) que le reste
    // de l'application. Purement informatif : ne sert qu'à l'éligibilité BA ci-dessous
    // (baEligible, voir baStatus.ts), jamais à un calcul de date de promotion.
    const ancienneteEchelon = joursComptablesEntre(dateAcces.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)) / 360;

    const { baEligible, baEchelonDepart } = computeBaStatus({
      echelonActuel,
      grade,
      proTypePromotion: null,
      proConfirmee: false,
      ancienneteEchelon,
    });

    if (baDecision && baEchelonDepart === null) {
      return res.status(400).json({ error: "La décision BA ne s'applique qu'à un échelon 6 ou 8" });
    }

    const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

    // Sans fichier rectorat, rien ne peut jamais renseigner proTypePromotion/proConfirmee tout
    // seul — et sans eux, computeBaStatus laisse baStatus à null pour toujours (voir ce champ's
    // doc comment), même quand baEligible dit oui : la colonne "Éligibilité BA" de l'onglet
    // Enseignants/Mailing (qui se fie à baStatus, jamais à baEligible, exprès) resterait donc
    // vide. `baDecision` ci-dessus est la réponse du gestionnaire à la question que le fichier
    // rectorat pose normalement lui-même ("BA." = candidat, "Pro BA." = promu) — on la traduit
    // directement dans les mêmes champs.
    //
    // dateProchainePromotionRectorat doit aussi être renseignée pour obtenir la bonne date malgré
    // resolveDateProchainePromotion (promotionState.ts) qui n'utilise JAMAIS le recalcul grille pour
    // un candidat BA : on calcule donc nous-même la date normale (non accélérée) une première fois
    // ici pour en déduire l'ancre que cette fonction attend (la date hypothétique accélérée, un an
    // avant la date normale — exactement la définition de "bonification d'un an").
    let proTypePromotion: string | null = null;
    let proConfirmee = false;
    let dateProchainePromotionRectorat: Date | null = null;
    if (baDecision) {
      proTypePromotion = "BA";
      proConfirmee = baDecision === "promu";
      const normalPromotion = computeEchelonPromotion({
        grille: gradeMapping.grille as GrilleCode,
        echelonDepart: echelonActuel,
        dateDernierChangementEchelon: dateAcces.toISOString().slice(0, 10),
        ancienneteADeduire: parseAncienneteText(deduire.value) ?? undefined,
        ancienneteAReporter: parseAncienneteText(reporter.value) ?? undefined,
        grilles: liveGrilles,
        valeurDuPoint: liveValeurDuPoint,
      });
      if (normalPromotion.dateProchainePromotion) {
        dateProchainePromotionRectorat = new Date(addCalendarYMD(normalPromotion.dateProchainePromotion, { annees: -1, mois: 0, jours: 0 }));
      }
    }

    const rectoratImport = await prisma.rectoratImport.create({
      data: { campagneId, grade, fileName: FILENAME_SAISIE_MANUELLE, importedBy: req.auth!.userId, rowCount: 1 },
    });

    const teacher = await prisma.teacher.create({ data: { isAdherentCorrige: isAdherent, ancienneteADeduire: deduire.value, ancienneteAReporter: reporter.value } });

    await prisma.teacherSnapshot.create({
      data: {
        campagneId,
        importId: rectoratImport.id,
        teacherId: teacher.id,
        nomUsage: nom.trim(),
        prenom: prenom.trim(),
        grade,
        echelonActuel,
        dateAccesEchelon: dateAcces,
        ancienneteEchelon,
        typePromotion: null,
        dureeRestante: null,
        proTypePromotion,
        proConfirmee,
        dateProchainePromotionRectorat,
        rowIndex: 0,
      },
    });

    const { warning } = await recomputeAndStorePromotionState({
      teacherId: teacher.id,
      campagneId,
      grade,
      echelonActuel,
      dateAccesEchelon: dateAcces,
      typePromotion: null,
      dureeRestante: null,
      ancienneteADeduireRaw: deduire.value,
      ancienneteAReporterManualRaw: reporter.value,
      proTypePromotion,
      proConfirmee,
      dateProchainePromotionRectorat,
      ancienneteEchelon,
      liveGrilles,
      liveValeurDuPoint: liveValeurDuPoint,
    });

    const state = await prisma.computedPromotionState.findUnique({
      where: { teacherId_campagneId: { teacherId: teacher.id, campagneId } },
    });

    res.status(201).json({
      teacherId: teacher.id,
      warning: warning ?? null,
      baEligible,
      baEchelonDepart,
      baStatus: state?.baStatus ?? null,
      dateProchainePromotion: state?.dateProchainePromotion ?? null,
      gainSalaireNet: state?.gainSalaireNet ?? null,
    });
  }),
);

/** Liste les saisies manuelles d'une campagne (celles dont le RectoratImport porte le fileName
 * "Saisie manuelle") — réutilise computeTeacherList (routes/teachers.ts) pour ne jamais présenter
 * de données qui divergent de l'onglet "Enseignants", puis filtre sur `isManual`. */
saisiesManuellesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
    if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
    const teachers = await computeTeacherList(campagneId);
    res.json(teachers.filter((t) => t.isManual));
  }),
);
