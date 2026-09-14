import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { estimateAgainstSeuil, isEligibleHorsClasse, isEligibleClasseExceptionnelle, GRADE_MAPPINGS } from "@spelc/domain";
import { parseZ2AGEA } from "@spelc/import";

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

    // The rectorat's "ECHELON : NN" page groups every record by the échelon it would ARRIVE at
    // if promoted this cycle, not the échelon it currently holds (confirmed against real files:
    // the page-footer "B A / A N" promouvables counts are per arrival page, and a "BA." marker —
    // the rectorat's own flag for "this promotion is a bonification d'ancienneté" — only ever
    // shows up there). BA only exists for the 6->7 and 8->9 transitions, so BA candidates
    // départ-échelon 6 are filed on the "07" page and départ-échelon 8 on the "09" page — never
    // on "06"/"08" themselves, which is why cross-checking an ancienneté window on those pages
    // used to find nobody eligible.
    const baEchelonDepart: 6 | 8 | undefined = snap.echelonActuel === "07" ? 6 : snap.echelonActuel === "09" ? 8 : undefined;
    const seuil =
      baEchelonDepart !== undefined ? seuils.find((s) => s.grade === snap.grade && s.echelonDepart === baEchelonDepart) : undefined;

    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === snap.grade);

    // null = not applicable (wrong grade or missing ancienneté data), not "not eligible".
    const horsClasseEligible =
      gradeMapping?.accesHorsClasse && snap.ancienneteEchelon != null
        ? isEligibleHorsClasse(snap.echelonActuel, snap.ancienneteEchelon)
        : null;

    const classeExceptionnelleEligible = gradeMapping?.accesClasseExceptionnelle
      ? isEligibleClasseExceptionnelle(snap.echelonActuel, gradeMapping.grille === "HC_AGR" ? "agrege" : "autre")
      : null;

    // null = not applicable (not on an arrival page the BA mechanism can lead to). Otherwise, true
    // whenever the rectorat's own "TRACK.date" marker names BA — whether or not it's confirmed
    // (see proConfirmee below): a candidate not yet selected is still "éligible".
    const baEligible = baEchelonDepart !== undefined ? snap.proTypePromotion === "BA" : null;

    const baEstimate =
      baEligible === true && baEchelonDepart !== undefined
        ? snap.proConfirmee
          ? // "Pro BA.date" — the rectorat already granted this promotion, nothing to estimate.
            "promu_estime"
          : seuil && snap.avisEvaluation != null && snap.ancienneteGrade != null && snap.ancienneteEchelon != null
            ? estimateAgainstSeuil(
                {
                  grade: snap.grade,
                  echelonDepart: baEchelonDepart,
                  barreme: snap.avisEvaluation,
                  ancienneteGrade: snap.ancienneteGrade,
                  ancienneteEchelon: snap.ancienneteEchelon,
                  age: snap.ageEncodedRectorat ? parseZ2AGEA(snap.ageEncodedRectorat).annees : 0,
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
            : null
        : null;

    return {
      teacherId: snap.teacherId,
      nom: snap.nomUsage,
      prenom: snap.prenom,
      grade: snap.grade,
      echelonActuel: snap.echelonActuel,
      dateAccesEchelon: snap.dateAccesEchelon,
      ancienneteEchelon: snap.ancienneteEchelon,
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
      baEligible,
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
