import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import {
  estimateAgainstSeuil,
  isEligibleBonificationAnciennete,
  isEligibleHorsClasse,
  isEligibleClasseExceptionnelle,
  GRADE_MAPPINGS,
} from "@spelc/domain";

export const teachersRouter = Router();

teachersRouter.use(requireAuth);

/**
 * List teachers for a campagne, joined with their latest snapshot, computed promotion state,
 * BA estimate (when applicable), and adhérent-matching status.
 */
teachersRouter.get("/", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;

  const snapshots = await prisma.teacherSnapshot.findMany({
    where: campagneId ? { campagneId } : undefined,
    include: {
      teacher: {
        include: {
          computedStates: campagneId ? { where: { campagneId } } : true,
          matchCandidate: { include: { adherent: true } },
        },
      },
    },
    orderBy: [{ nomUsage: "asc" }, { prenom: "asc" }],
  });

  const seuils = campagneId ? await prisma.baSeuil.findMany({ where: { campagneId } }) : [];

  const result = snapshots.map((snap) => {
    const state = snap.teacher.computedStates[0];
    const echelonDepart = state ? Number(state.echelonDepart) : undefined;
    const seuil =
      echelonDepart === 6 || echelonDepart === 8
        ? seuils.find((s) => s.grade === snap.grade && s.echelonDepart === echelonDepart)
        : undefined;

    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === snap.grade);

    // null = not applicable (wrong grade or missing ancienneté data), not "not eligible".
    const horsClasseEligible =
      gradeMapping?.accesHorsClasse && snap.ancienneteEchelon != null
        ? isEligibleHorsClasse(snap.echelonActuel, snap.ancienneteEchelon)
        : null;

    const classeExceptionnelleEligible = gradeMapping?.accesClasseExceptionnelle
      ? isEligibleClasseExceptionnelle(snap.echelonActuel, gradeMapping.grille === "HC_AGR" ? "agrege" : "autre")
      : null;

    // PPCR eligibility windows: échelon 6 -> 7 only in the échelon's 2nd year, échelon 8 -> 9 only
    // between 18 and 30 months in — outside that window a teacher isn't even a BA candidate this
    // campaign, whatever their barème/ancienneté, so no estimate should be shown at all.
    const baEligible =
      (echelonDepart === 6 || echelonDepart === 8) &&
      snap.ancienneteEchelon != null &&
      isEligibleBonificationAnciennete(echelonDepart, snap.ancienneteEchelon);

    const baEstimate =
      baEligible && seuil && snap.avisEvaluation != null && snap.ancienneteGrade != null && snap.ancienneteEchelon != null
        ? estimateAgainstSeuil(
            {
              grade: snap.grade,
              echelonDepart: echelonDepart as 6 | 8,
              barreme: snap.avisEvaluation,
              ancienneteGrade: snap.ancienneteGrade,
              ancienneteEchelon: snap.ancienneteEchelon,
              // Age isn't wired up yet (the rectorat's Z2AGEA encoding needs its own parser) —
              // treated as best-case so the estimate falls back to the ancienneté tie-break only.
              age: 0,
            },
            seuil
              ? {
                  grade: seuil.grade,
                  echelonDepart: seuil.echelonDepart as 6 | 8,
                  nombrePromusBA: seuil.nombrePromusBa,
                  minBarreme: seuil.minBareme,
                  minAncienneteGrade: seuil.minAncienneteGrade,
                  minAncienneteEchelon: seuil.minAncienneteEchelon,
                  minAge: seuil.minAge,
                }
              : undefined,
          )
        : null;

    return {
      teacherId: snap.teacherId,
      nom: snap.nomUsage,
      prenom: snap.prenom,
      grade: snap.grade,
      echelonActuel: snap.echelonActuel,
      dateAccesEchelon: snap.dateAccesEchelon,
      avisEvaluation: snap.avisEvaluation,
      computedState: state
        ? {
            grilleCode: state.grilleCode,
            echelonSuivant: state.echelonSuivant,
            indiceActuel: state.indiceActuel,
            futurIndice: state.futurIndice,
            gainSalaireBrut: state.gainSalaireBrut,
            gainSalaireNet: state.gainSalaireNet,
            dateProchainePromotion: state.dateProchainePromotion,
          }
        : null,
      matching: snap.teacher.matchCandidate
        ? {
            status: snap.teacher.matchCandidate.status,
            adherentNom: snap.teacher.matchCandidate.adherent.nom,
            adherentPrenom: snap.teacher.matchCandidate.adherent.prenom,
          }
        : { status: "NON_ADHERENT" as const },
      seuilBa: seuil
        ? { minBareme: seuil.minBareme, locked: seuil.locked, nombrePromusBa: seuil.nombrePromusBa }
        : null,
      baEstimate,
      horsClasseEligible,
      classeExceptionnelleEligible,
    };
  });

  res.json(result);
});

teachersRouter.get("/:id", async (req, res) => {
  const teacher = await prisma.teacher.findUnique({
    where: { id: req.params.id },
    include: {
      snapshots: { orderBy: { dateAccesEchelon: "desc" } },
      computedStates: true,
      matchCandidate: { include: { adherent: true } },
    },
  });
  if (!teacher) return res.status(404).json({ error: "Enseignant introuvable" });
  res.json(teacher);
});
