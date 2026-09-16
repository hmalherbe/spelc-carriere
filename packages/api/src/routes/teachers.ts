import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import {
  estimateAgainstSeuil,
  isEligibleHorsClasse,
  isEligibleClasseExceptionnelle,
  isEligibleBonificationAnciennete,
  computeEchelonPromotion,
  GRADE_MAPPINGS,
  type GrilleCode,
} from "@spelc/domain";
import { parseZ2AGEA } from "@spelc/import";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { computeBaRanking } from "../baRanking.js";

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
  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

  // Determines who actually got the bonification d'ancienneté this cycle — NOT from any per-record
  // marker (verified unreliable for BA specifically: real promoted candidates carried none), but by
  // ranking every BA candidate in each (grade, échelon départ) group against that group's own known
  // headcount from the rectorat file. See baRanking.ts.
  const { winners: baWinners, rankable: baRankable } = computeBaRanking(snapshots);

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

    // Éligibilité per the union's own rule: échelon départ 6 or 8 AND ancienneté in the official
    // window (12-24 months at échelon 6, 18-30 at échelon 8) — independent of any marker. A "BA"
    // marker alone is NOT sufficient: verified on a real file where two records carried one with
    // 3.00 years' ancienneté (a plain completed AN case, not a BA candidate at all). PROMOTION
    // (baConfirmee below), separately, additionally requires that marker, among the éligibles.
    // null = not applicable (not on an arrival page the BA mechanism can lead to, or ancienneté
    // missing), not "non éligible".
    const baEligible =
      baEchelonDepart !== undefined && snap.ancienneteEchelon != null
        ? isEligibleBonificationAnciennete(baEchelonDepart, snap.ancienneteEchelon)
        : null;

    // Whether this record is even a candidate for the BA mechanism at all — the rectorat's own
    // "TRACK.date" marker naming BA — as opposed to éligibilité above (window-only, per the
    // union's rule) or baConfirmee below (ranked outcome, restricted to éligible BA candidates).
    const isBaCandidate = baEchelonDepart !== undefined && snap.proTypePromotion === "BA";

    // true = ranked among the actual winners; false = ranked, but not among them (a known fact,
    // not a guess); null = couldn't rank this candidate's group (missing headcount or data, or
    // simply not éligible/not BA-marked) — falls back to the seuil-based estimate below.
    const baConfirmee = isBaCandidate ? (baRankable.has(snap.teacherId) ? baWinners.has(snap.teacherId) : null) : null;

    const baEstimate =
      baEligible === true && baEchelonDepart !== undefined
        ? baConfirmee != null
          ? baConfirmee
            ? "promu_estime"
            : "non_promu_estime"
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

    // For a candidate NOT confirmed as having actually arrived this cycle — a BA candidate who
    // isn't a ranked winner (baConfirmee !== true), or an AN/CL/RE record whose own "Pro" marker
    // isn't set — `echelonActuel` ("07"/"09") and the computedState derived from it
    // (echelonSuivant/gains/date, computed at import time as if it were the départ échelon — see
    // routes/imports.ts) are both one étape too far: the teacher hasn't actually arrived there yet.
    // Recompute échelon/gain display from the real départ (baEchelonDepart, 6 or 8) instead — a
    // pure grille lookup, so safe regardless of anything still unverified about what
    // `dateAccesEchelon` itself anchors.
    const arrivedThisEchelon = isBaCandidate ? baConfirmee === true : snap.proConfirmee;
    let echelonActuelAffiche = snap.echelonActuel;
    let computedStateAffiche = state
      ? {
          grilleCode: state.grilleCode,
          echelonSuivant: state.echelonSuivant,
          indiceActuel: state.indiceActuel,
          futurIndice: state.futurIndice,
          gainSalaireBrut: state.gainSalaireBrut,
          gainSalaireNet: state.gainSalaireNet,
          dateProchainePromotion: state.dateProchainePromotion,
        }
      : null;

    if (baEchelonDepart !== undefined && !arrivedThisEchelon && gradeMapping && snap.dateAccesEchelon) {
      try {
        const promotion = computeEchelonPromotion({
          grille: gradeMapping.grille as GrilleCode,
          echelonDepart: String(baEchelonDepart),
          dateDernierChangementEchelon: snap.dateAccesEchelon.toISOString().slice(0, 10),
          grilles: liveGrilles,
          valeurDuPoint: liveValeurDuPoint,
        });
        echelonActuelAffiche = String(baEchelonDepart);
        computedStateAffiche = {
          grilleCode: promotion.grille,
          echelonSuivant: String(promotion.echelonSuivant),
          indiceActuel: promotion.indiceActuel,
          futurIndice: promotion.futurIndice,
          gainSalaireBrut: promotion.gainSalaireBrut,
          gainSalaireNet: promotion.gainSalaireNet,
          dateProchainePromotion: promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
        };
      } catch {
        // Échelon introuvable dans la grille (donnée aberrante) — on garde l'affichage d'origine
        // plutôt que de faire échouer toute la liste pour une fiche.
      }
    }

    return {
      teacherId: snap.teacherId,
      nom: snap.nomUsage,
      prenom: snap.prenom,
      grade: snap.grade,
      echelonActuel: echelonActuelAffiche,
      dateAccesEchelon: snap.dateAccesEchelon,
      ancienneteEchelon: snap.ancienneteEchelon,
      avisEvaluation: snap.avisEvaluation,
      computedState: computedStateAffiche,
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
      // The rendez-vous de carrière échelon the BA rule actually describes (6 or 8) — same value
      // as `echelonActuel` above once corrected for an unconfirmed candidate, surfaced explicitly
      // here for the "Éligibilité BA" column.
      baEchelonDepart: baEchelonDepart ?? null,
      // true = ranked among this section's actual BA winners (a known fact, not an estimate —
      // must not be labeled "(estimé)"); false = ranked, but not among them (also a known fact);
      // null = couldn't rank (see baEstimate for the fallback guess in that case).
      baConfirmee,
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
