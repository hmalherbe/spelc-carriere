import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { importAdherentRecords } from "../adherentImport.js";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { computeEchelonPromotion, GRADE_MAPPINGS, type GrilleCode } from "@spelc/domain";
import { extractPdfText, parseRectoratFile, parseAdherentCsv, normalizeName } from "@spelc/import";

export const importsRouter = Router();
importsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * Maps the rectorat's own numeric grade code (as printed on every export, e.g. "4531 : ECR
 * PROFESSEUR CERTIFIE CL. NORMALE") to our normalized grade label (GradeMapping.grade in
 * @spelc/domain, e.g. "CERTIFIE"). Only the 5 codes actually observed in the sample files are
 * mapped — an unrecognized code fails the import loudly rather than silently misfiling records
 * under the wrong grille (wrong grille -> wrong indice -> wrong salary, silently).
 */
const RECTORAT_GRADE_CODE_MAP: Record<string, string> = {
  "4531": "CERTIFIE",
  "4532": "CERTIFIE HC",
  "4534": "CERTIFIE EXC",
  "4511": "AGREGE HC",
  "4512": "AGREGE",
};

importsRouter.post("/rectorat", requireRole("ADMIN", "GESTIONNAIRE"), upload.single("file"), asyncHandler(async (req, res) => {
  const { campagneId } = req.body as { campagneId?: string };
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });
  if (!req.file) return res.status(400).json({ error: "Fichier PDF requis (champ 'file')" });

  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable" });

  const text = await extractPdfText(req.file.buffer);
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

  // Loaded once per import, not per row: an admin's edited indices / revalorised valeur du point
  // (see routes/grilles.ts) must be reflected in newly computed promotions.
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

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
        typePromotion: record.typePromotion,
        dureeRestante: record.dureeRestante,
        dateProchainePromotionRectorat: record.dateProchainePromotionRectorat ? new Date(record.dateProchainePromotionRectorat) : null,
      },
    });

    if (record.dateAccesEchelon) {
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
    }

    imported++;
    if (record.warnings.length > 0) {
      warnings.push({ nomUsage: record.nomUsage, prenom: record.prenom, warnings: record.warnings });
    }
  }

  res.status(201).json({ importId: rectoratImport.id, grade, imported, warnings });
}));

importsRouter.post("/adherents", requireRole("ADMIN", "GESTIONNAIRE"), upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier CSV requis (champ 'file')" });

  const csvText = req.file.buffer.toString("utf-8");
  const { records, unmappedFields } = parseAdherentCsv(csvText);
  const { created, updated, matching } = await importAdherentRecords(records);

  res.status(201).json({ created, updated, unmappedFields, matching });
}));
