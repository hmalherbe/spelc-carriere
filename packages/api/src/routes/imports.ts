import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { importAdherentRecords, matchUnresolvedAdherents } from "../adherentImport.js";
import { deriveAncienneteAReporter } from "../ancienneteReportee.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import {
  computeEchelonPromotion,
  deriveEchelonActuelFromProjection,
  deriveNumericEchelonAliases,
  GRADE_MAPPINGS,
  type GrilleCode,
} from "@spelc/domain";
import {
  extractPdfText,
  parseRectoratFile,
  parseAdherentCsv,
  parseAdherentXlsx,
  parseAcademicEmailXlsx,
  normalizeName,
} from "@spelc/import";

export const importsRouter = Router();
importsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * Maps the rectorat's own numeric grade code (as printed on every export, e.g. "4531 : ECR
 * PROFESSEUR CERTIFIE CL. NORMALE") to our normalized grade label (GradeMapping.grade in
 * @spelc/domain, e.g. "CERTIFIE"). Only the codes actually observed in imported files are mapped —
 * an unrecognized code fails the import loudly rather than silently misfiling records under the
 * wrong grille (wrong grille -> wrong indice -> wrong salary, silently).
 */
const RECTORAT_GRADE_CODE_MAP: Record<string, string> = {
  "4531": "CERTIFIE",
  "4532": "CERTIFIE HC",
  "4534": "CERTIFIE EXC",
  "4511": "AGREGE HC",
  "4512": "AGREGE",
  "4513": "AGREGE EXC",
  "4311": "PEPS",
  "4312": "PEPS HC",
  "4314": "PEPS EXC",
  "4754": "PLP",
  "4755": "PLP HC",
  "4757": "PLP EXC",
};

importsRouter.post("/rectorat", requireRole("ADMIN", "GESTIONNAIRE"), upload.single("file"), asyncHandler(async (req, res) => {
  const { campagneId } = req.body as { campagneId?: string };
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  if (!req.file) return res.status(400).json({ error: "Fichier requis (champ 'file'), en PDF ou en texte brut" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  // Accepts either the rectorat's native PDF export, or the same "AVANCEMENT D'ECHELON" content
  // already as plain text (e.g. copié-collé depuis un lecteur PDF, ou déjà extrait par un autre
  // outil) — same parser either way, just skipping the PDF text-extraction step for .txt.
  const isTxt = /\.txt$/i.test(req.file.originalname);
  const text = isTxt ? req.file.buffer.toString("utf-8") : await extractPdfText(req.file.buffer);
  const parsed = parseRectoratFile(text);

  if (parsed.grades.length === 0) {
    return res.status(422).json({ error: "Aucun grade reconnu dans ce fichier." });
  }

  // Loaded once per import, not per row: an admin's edited indices / revalorised valeur du point
  // (see routes/grilles.ts) must be reflected in newly computed promotions.
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

  // Build a (name, grade) -> teacherId lookup from every snapshot ever imported (any campagne), so
  // a teacher re-appearing in a later campaign — or in another grade block of THIS SAME file, for a
  // combined "CN-HC-CE" export — reuses their existing Teacher row instead of forking a duplicate
  // identity. Exact match on normalized nom+prénom — deliberately NOT fuzzy here, unlike the
  // adherent matching: within the rectorat's own data, the same person's name should be spelled
  // consistently campaign to campaign (same source system), so a stricter bar is safer.
  //
  // Grade is part of the key, strictly (no CN/HC/EXC tolerance): two records with the same name
  // but different grades are treated as two different people, full stop — even a genuine hors-
  // classe promotion (CERTIFIE -> CERTIFIE HC) starts a new Teacher identity rather than continuing
  // the old one. Per product decision: a same-name-different-grade homonym is common enough (and a
  // silently wrong merge bad enough — it would blend two different careers' history/computed
  // states under one Teacher) that requiring an exact grade match, even at the cost of splitting a
  // real promotion's history, is the safer default.
  //
  // Shared across every grade block below and updated as new teachers get created along the way.
  const existingSnapshots = await prisma.teacherSnapshot.findMany({ select: { teacherId: true, nomUsage: true, prenom: true, grade: true } });
  const teacherIdByName = new Map<string, string>();
  for (const s of existingSnapshots) {
    teacherIdByName.set(`${normalizeName(s.nomUsage)}|${normalizeName(s.prenom)}|${s.grade}`, s.teacherId);
  }

  const results: {
    gradeCode: string;
    grade: string;
    imported: number;
    warnings: { nomUsage: string; prenom: string; warnings: string[] }[];
    error?: string;
  }[] = [];

  for (const gradeBlock of parsed.grades) {
    const grade = RECTORAT_GRADE_CODE_MAP[gradeBlock.gradeCode];
    if (!grade) {
      results.push({
        gradeCode: gradeBlock.gradeCode,
        grade: gradeBlock.gradeLabel,
        imported: 0,
        warnings: [],
        error: `Code grade rectorat "${gradeBlock.gradeCode}" non reconnu — ajoutez-le à RECTORAT_GRADE_CODE_MAP avant de réimporter.`,
      });
      continue;
    }
    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === grade)!;

    // For agrégés hors-classe/classe-exceptionnelle (HC_AGR, EXC_AGR, EXC_PROFS), the rectorat's
    // own PDF keeps counting échelons numerically past the grille's own plain-numeric range, where
    // @spelc/domain instead switches to letter codes ("A1"/"A2"/"A3"/"B1"/"B2"/"B3" — the label the
    // union's own rules, e.g. isEligibleClasseExceptionnelle, use to talk about them). See
    // deriveNumericEchelonAliases for how the continuation is derived (verified against real HC_AGR
    // data). Translating here, at the boundary, keeps the letter codes as the single source of
    // truth everywhere else in the app.
    const echelonAliases = deriveNumericEchelonAliases(gradeMapping.grille as GrilleCode);
    if (Object.keys(echelonAliases).length > 0) {
      for (const record of gradeBlock.records) {
        record.echelonActuel = echelonAliases[record.echelonActuel] ?? record.echelonActuel;
      }
      for (const section of gradeBlock.sections) {
        section.echelon = echelonAliases[section.echelon] ?? section.echelon;
      }
    }

    const rectoratImport = await prisma.rectoratImport.create({
      data: {
        campagneId,
        grade: `${gradeBlock.gradeCode} : ${gradeBlock.gradeLabel}`,
        fileName: req.file.originalname,
        importedBy: req.auth!.userId,
        rowCount: gradeBlock.records.length,
      },
    });

    // Re-importing a corrected file for a grade already loaded in this campagne must supersede the
    // old fiches, not sit alongside them — otherwise every affected teacher would show up twice on
    // the dashboard. Safe to do only after the name -> teacherId map above is built, so a teacher
    // whose only snapshot was in this campagne still resolves to their existing Teacher row instead
    // of forking a new one once their old snapshot is gone.
    await prisma.teacherSnapshot.deleteMany({ where: { campagneId, grade } });

    const nombrePromusBaBySection = new Map(gradeBlock.sections.map((s) => [s.echelon, s.nombrePromusBA]));

    const warnings: { nomUsage: string; prenom: string; warnings: string[] }[] = [];
    let imported = 0;

    for (const [rowIndex, record] of gradeBlock.records.entries()) {
      const key = `${normalizeName(record.nomUsage)}|${normalizeName(record.prenom)}|${grade}`;
      let teacherId = teacherIdByName.get(key);
      if (!teacherId) {
        const teacher = await prisma.teacher.create({ data: {} });
        teacherId = teacher.id;
        teacherIdByName.set(key, teacherId);
      }

      // A teacher must never carry more than one snapshot in the same campagne: if this same
      // person was already filed under a DIFFERENT grade in this campagne — whether from another
      // block of this very file (a combined CN-HC-CE export) or from a past import that mis-
      // detected their grade — that stale cross-grade snapshot must not coexist with this one.
      await prisma.teacherSnapshot.deleteMany({ where: { campagneId, teacherId, NOT: { grade } } });

      // nombrePromusBaSection is keyed by the section's own header value (the projection/target
      // échelon — see deriveEchelonActuelFromProjection below), so this lookup must happen BEFORE
      // record.echelonActuel is corrected to the teacher's true départ échelon a few lines down.
      const nombrePromusBaSection = nombrePromusBaBySection.get(record.echelonActuel) ?? null;
      // Zero-padded to match the two-digit convention the rectorat's own file uses everywhere else
      // ("06", "07", "09"...) — the raw échelon codes in the grille tables are plain numbers (6, not
      // "06"), so deriveEchelonActuelFromProjection's own return value isn't padded; leaving it as
      // "6" here would silently split every exact-string comparison downstream that still expects
      // the padded form (baStatus.ts's BA-window detection, the Dashboard's échelon dropdown) into
      // two distinct values for the same échelon depending on which import produced the row.
      record.echelonActuel = String(
        deriveEchelonActuelFromProjection(gradeMapping.grille as GrilleCode, record.echelonActuel, liveGrilles),
      ).padStart(2, "0");

      await prisma.teacherSnapshot.create({
        data: {
          campagneId,
          importId: rectoratImport.id,
          teacherId,
          nomUsage: record.nomUsage,
          prenom: record.prenom,
          grade,
          dateNaissance: record.dateNaissance ? new Date(record.dateNaissance) : null,
          rneEtablissement: record.rneEtablissement,
          nomEtablissement: record.nomEtablissement,
          typeEtablissement: record.typeEtablissement,
          codePostal: record.codePostal,
          ville: record.ville,
          disciplineCode: record.disciplineCode,
          disciplineLibelle: record.disciplineLibelle,
          echelonActuel: record.echelonActuel,
          dateAccesEchelon: record.dateAccesEchelon ? new Date(record.dateAccesEchelon) : new Date(campagne.periodeDebut),
          avisEvaluation: record.avisEvaluation,
          ancienneteGrade: record.ancienneteGrade,
          ancienneteEchelon: record.ancienneteEchelon,
          ageEncodedRectorat: record.ageEncodedRectorat,
          typePromotion: record.typePromotion,
          dureeRestante: record.dureeRestante,
          dateProchainePromotionRectorat: record.dateProchainePromotionRectorat ? new Date(record.dateProchainePromotionRectorat) : null,
          proTypePromotion: record.proTypePromotion,
          proConfirmee: record.proConfirmee,
          nombrePromusBaSection,
          rowIndex,
        },
      });

      const recordWarnings = [...record.warnings];

      if (record.dateAccesEchelon) {
        try {
          const promotion = computeEchelonPromotion({
            grille: gradeMapping.grille as GrilleCode,
            echelonDepart: record.echelonActuel,
            dateDernierChangementEchelon: record.dateAccesEchelon,
            ancienneteAReporter: deriveAncienneteAReporter(record.typePromotion, record.dureeRestante),
            grilles: liveGrilles,
            valeurDuPoint: liveValeurDuPoint,
          });
          await prisma.computedPromotionState.upsert({
            where: { teacherId_campagneId: { teacherId, campagneId } },
            update: {
              grilleCode: promotion.grille,
              echelonDepart: String(promotion.echelonDepart),
              echelonSuivant: String(promotion.echelonSuivant),
              indiceActuel: promotion.indiceActuel,
              futurIndice: promotion.futurIndice,
              gainSalaireBrut: promotion.gainSalaireBrut,
              gainSalaireNet: promotion.gainSalaireNet,
              dateProchainePromotion: promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
            },
            create: {
              teacherId,
              campagneId,
              grilleCode: promotion.grille,
              echelonDepart: String(promotion.echelonDepart),
              echelonSuivant: String(promotion.echelonSuivant),
              indiceActuel: promotion.indiceActuel,
              futurIndice: promotion.futurIndice,
              gainSalaireBrut: promotion.gainSalaireBrut,
              gainSalaireNet: promotion.gainSalaireNet,
              dateProchainePromotion: promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
            },
          });
        } catch (e) {
          // Échelon introuvable dans la grille de ce grade (donnée aberrante, ou grade mal détecté
          // pour cette fiche) — signale la fiche en avertissement plutôt que de faire échouer tout le
          // fichier : les autres fiches, elles, sont valides et ne doivent pas être perdues avec elle.
          const message = e instanceof Error ? e.message : String(e);
          recordWarnings.push(`Calcul de la promotion impossible : ${message}`);
        }
      }

      imported++;
      if (recordWarnings.length > 0) {
        warnings.push({ nomUsage: record.nomUsage, prenom: record.prenom, warnings: recordWarnings });
      }
    }

    results.push({ gradeCode: gradeBlock.gradeCode, grade, imported, warnings });
  }

  // A rectorat import is exactly what can resolve an adhérent whose matching attempt previously
  // found "Aucune correspondance trouvée" simply because their teacher hadn't been imported yet —
  // retry every adhérent still stuck that way now that this file added (potentially) new teachers.
  await matchUnresolvedAdherents();

  res.status(201).json({ results });
}));

// Manual fallback to the ADEL automation: same export a human would download by hand from ADEL
// (Excel) or the older CSV format, uploaded and matched through the exact same engine.
importsRouter.post("/adherents", requireRole("ADMIN", "GESTIONNAIRE"), upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier requis (champ 'file')" });

  const isXlsx = /\.xlsx$/i.test(req.file.originalname);
  const { records, unmappedFields } = isXlsx
    ? await parseAdherentXlsx(req.file.buffer)
    : parseAdherentCsv(req.file.buffer.toString("utf-8"));
  const { created, updated, matching } = await importAdherentRecords(records);

  res.status(201).json({ created, updated, unmappedFields, matching });
}));

// Académie staff-directory export (nom/prénom -> adresse mail académique) — used by the mailing
// feature to reach non-adhérents, who have no personal address on file. A reference dataset with
// no stable ID to upsert against between imports and nothing else referencing it, so each import
// simply replaces the whole table wholesale rather than trying to reconcile row by row.
importsRouter.post(
  "/academic-emails",
  requireRole("ADMIN", "GESTIONNAIRE"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Fichier requis (champ 'file')" });

    const { records, unmappedFields } = await parseAcademicEmailXlsx(req.file.buffer);
    if (unmappedFields.length > 0) {
      return res
        .status(422)
        .json({ error: `Colonnes attendues introuvables dans le fichier : ${unmappedFields.join(", ")}`, unmappedFields });
    }

    await prisma.$transaction([prisma.academicEmail.deleteMany({}), prisma.academicEmail.createMany({ data: records })]);

    res.status(201).json({ imported: records.length });
  }),
);
