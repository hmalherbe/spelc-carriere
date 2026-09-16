import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { importAdherentRecords } from "../adherentImport.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { recomputeBaSeuils } from "../baSeuilCompute.js";
import { computeEchelonPromotion, GRADE_MAPPINGS, type GrilleCode } from "@spelc/domain";
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

  const grade = RECTORAT_GRADE_CODE_MAP[parsed.gradeCode];
  if (!grade) {
    return res.status(422).json({
      error: `Code grade rectorat "${parsed.gradeCode}" non reconnu — ajoutez-le à RECTORAT_GRADE_CODE_MAP avant de réimporter.`,
    });
  }
  const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === grade)!;

  const rectoratImport = await prisma.rectoratImport.create({
    data: {
      campagneId,
      grade: `${parsed.gradeCode} : ${parsed.gradeLabel}`,
      fileName: req.file.originalname,
      importedBy: req.auth!.userId,
      rowCount: parsed.records.length,
    },
  });

  // Build a name -> teacherId lookup from every snapshot ever imported (any campagne), so a
  // teacher re-appearing in a later campaign reuses their existing Teacher row instead of forking
  // a duplicate identity. Exact match on normalized nom+prénom — deliberately NOT fuzzy here,
  // unlike the adherent matching: within the rectorat's own data, the same person's name should be
  // spelled consistently campaign to campaign (same source system), so a stricter bar is safer.
  const existingSnapshots = await prisma.teacherSnapshot.findMany({ select: { teacherId: true, nomUsage: true, prenom: true } });
  const teacherIdByName = new Map<string, string>();
  for (const s of existingSnapshots) {
    teacherIdByName.set(`${normalizeName(s.nomUsage)}|${normalizeName(s.prenom)}`, s.teacherId);
  }

  // Re-importing a corrected file for a grade already loaded in this campagne must supersede the
  // old fiches, not sit alongside them — otherwise every affected teacher would show up twice on
  // the dashboard. Safe to do only after the name -> teacherId map above is built, so a teacher
  // whose only snapshot was in this campagne still resolves to their existing Teacher row instead
  // of forking a new one once their old snapshot is gone.
  await prisma.teacherSnapshot.deleteMany({ where: { campagneId, grade } });

  // Loaded once per import, not per row: an admin's edited indices / revalorised valeur du point
  // (see routes/grilles.ts) must be reflected in newly computed promotions.
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

  const nombrePromusBaBySection = new Map(parsed.sections.map((s) => [s.echelon, s.nombrePromusBA]));

  const warnings: { nomUsage: string; prenom: string; warnings: string[] }[] = [];
  let imported = 0;

  for (const record of parsed.records) {
    const key = `${normalizeName(record.nomUsage)}|${normalizeName(record.prenom)}`;
    let teacherId = teacherIdByName.get(key);
    if (!teacherId) {
      const teacher = await prisma.teacher.create({ data: {} });
      teacherId = teacher.id;
      teacherIdByName.set(key, teacherId);
    }

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
        nombrePromusBaSection: nombrePromusBaBySection.get(record.echelonActuel) ?? null,
      },
    });

    const recordWarnings = [...record.warnings];

    if (record.dateAccesEchelon) {
      try {
        const promotion = computeEchelonPromotion({
          grille: gradeMapping.grille as GrilleCode,
          echelonDepart: record.echelonActuel,
          dateDernierChangementEchelon: record.dateAccesEchelon,
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

  // The BA seuils an admin sees on the "Seuils BA" page are auto-inferred from this campagne's own
  // imported BA promotions — recomputed after every rectorat import so they reflect the latest
  // data, without ever touching a row the admin has locked (see baSeuilCompute.ts).
  await recomputeBaSeuils(campagneId);

  res.status(201).json({ importId: rectoratImport.id, grade, imported, warnings });
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
