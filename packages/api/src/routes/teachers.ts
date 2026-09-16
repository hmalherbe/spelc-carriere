import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import {
  isEligibleHorsClasse,
  isEligibleClasseExceptionnelle,
  isEligibleBonificationAnciennete,
  computeEchelonPromotion,
  GRADE_MAPPINGS,
  type GrilleCode,
} from "@spelc/domain";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";

export const teachersRouter = Router();

teachersRouter.use(requireAuth);

/**
 * List teachers for a campagne, joined with their latest snapshot, computed promotion state,
 * BA status (when applicable), and adhérent-matching status.
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
    // (baStatus below), separately, additionally requires that marker, among the éligibles.
    // null = not applicable (not on an arrival page the BA mechanism can lead to, or ancienneté
    // missing), not "non éligible".
    const baEligible =
      baEchelonDepart !== undefined && snap.ancienneteEchelon != null
        ? isEligibleBonificationAnciennete(baEchelonDepart, snap.ancienneteEchelon)
        : null;

    // Whether this record is even a candidate for the BA mechanism at all — the rectorat's own
    // "TRACK.date" marker naming BA — as opposed to éligibilité above (window-only, per the
    // union's rule).
    const isBaCandidate = baEchelonDepart !== undefined && snap.proTypePromotion === "BA";

    // Agrégés' BA promotion is decided at the national level (proposition), not locally by this
    // département's own rectorat file — that's exactly why its "Pro"/no-"Pro" marker isn't a
    // reliable promoted/not-promoted signal for them specifically (verified: real agrégé BA
    // winners carried no "Pro" prefix at all). So for agrégés we only ever report the candidacy
    // itself, never a promoted/non-promu call. For every other grade the promotion IS decided
    // locally, so the "Pro" prefix is authoritative: "Pro BA." = promu, bare "BA." = éligible but
    // pas promu.
    const isAgrege = snap.grade.startsWith("AGREGE");

    const baStatus: "national" | "promu" | "non_promu" | null = !isBaCandidate
      ? null
      : isAgrege
        ? "national"
        : snap.proConfirmee
          ? "promu"
          : "non_promu";

    // For échelon-display purposes: did this record actually ARRIVE at the new échelon this
    // cycle? Agrégé BA candidates are always treated as not-yet-arrived, since the national
    // decision can't be read from this file; every other record's own "Pro" marker (whether or
    // not it's a BA record) already answers this directly.
    const arrivedThisEchelon = isAgrege && isBaCandidate ? false : snap.proConfirmee;
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
        // Zero-padded to match the convention every raw echelonActuel value already uses ("06",
        // "07"...) — an unpadded "6" here would silently fork the dashboard's Échelon dropdown and
        // filters into two entries for the same échelon, one per underlying string.
        echelonActuelAffiche = String(baEchelonDepart).padStart(2, "0");
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
      // "national" = agrégé BA candidate (proposition nationale, statut non déterminable ici) ;
      // "promu" / "non_promu" = non-agrégé BA candidate, per the rectorat's own "Pro" marker ;
      // null = not a BA candidate this cycle (no "BA" marker), regardless of éligibilité above.
      baStatus,
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
