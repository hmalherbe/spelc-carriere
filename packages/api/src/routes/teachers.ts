import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  isEligibleHorsClasse,
  isEligibleClasseExceptionnelle,
  computeEchelonPromotion,
  parseAncienneteText,
  GRADE_MAPPINGS,
  type GrilleCode,
} from "@spelc/domain";
import { loadLiveGrilles, loadCurrentValeurDuPoint } from "../liveGrilles.js";
import { computeBaStatus } from "../baStatus.js";
import { recomputeAndStorePromotionState } from "../promotionState.js";

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

  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);

  const result = snapshots.map((snap) => {
    const state = snap.teacher.computedStates[0];

    // BA candidacy/status/arrival — extracted to baStatus.ts (long rationale kept there) so
    // routes/stats.ts can aggregate over the exact same rule without re-deriving it.
    const { baEchelonDepart, baEligible, isBaCandidate, baStatus, arrivedThisEchelon } = computeBaStatus(snap);

    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === snap.grade);

    // null = not applicable (wrong grade or missing ancienneté data), not "not eligible".
    const horsClasseEligible =
      gradeMapping?.accesHorsClasse && snap.ancienneteEchelon != null
        ? isEligibleHorsClasse(snap.echelonActuel, snap.ancienneteEchelon)
        : null;

    const classeExceptionnelleEligible = gradeMapping?.accesClasseExceptionnelle
      ? isEligibleClasseExceptionnelle(snap.echelonActuel, gradeMapping.grille === "HC_AGR" ? "agrege" : "autre")
      : null;

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

    if (baEchelonDepart !== null && !arrivedThisEchelon && gradeMapping && snap.dateAccesEchelon) {
      try {
        const promotion = computeEchelonPromotion({
          grille: gradeMapping.grille as GrilleCode,
          echelonDepart: String(baEchelonDepart),
          dateDernierChangementEchelon: snap.dateAccesEchelon.toISOString().slice(0, 10),
          ancienneteADeduire: parseAncienneteText(snap.teacher.ancienneteADeduire),
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
          // For a BA candidate, the rectorat's own file already states the échéance date next to
          // the "BA."/"Pro BA." marker (dateProchainePromotionRectorat) — that's the real date,
          // not something to re-derive from a generic duration-from-départ calculation. Prefer it
          // whenever the file provided one; fall back to our own computed projection only if it
          // didn't (should not normally happen for a genuine BA record).
          dateProchainePromotion:
            isBaCandidate && snap.dateProchainePromotionRectorat
              ? snap.dateProchainePromotionRectorat
              : promotion.dateProchainePromotion
                ? new Date(promotion.dateProchainePromotion)
                : null,
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
      // Position this record held within its own rectorat file (see schema.prisma's rowIndex) —
      // meaningful only within a single grade (each grade is its own separate file), which is why
      // the "fichier" sort in DashboardPage.tsx groups by grade first, then by this field.
      fileOrder: snap.rowIndex,
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
      // The rendez-vous de carrière échelon the BA rule actually describes (6 or 8) — same value
      // as `echelonActuel` above once corrected for an unconfirmed candidate, surfaced explicitly
      // here for the "Éligibilité BA" column.
      baEchelonDepart: baEchelonDepart ?? null,
      // "hors_fenetre" = BA candidate, but ancienneté outside the official window (anomaly) ;
      // "national" = agrégé BA candidate, in-window (proposition nationale, statut non
      // déterminable ici) ; "promu" / "non_promu" = non-agrégé BA candidate, in-window, per the
      // rectorat's own "Pro" marker ; null = not a BA candidate this cycle (no "BA" marker) —
      // shown regardless of baEligible below, which is irrelevant noise for a non-candidate.
      baStatus,
      baEligible,
      horsClasseEligible,
      classeExceptionnelleEligible,
      // Manual career-interruption correction (see Teacher.ancienneteADeduire's doc comment) —
      // exposed so DashboardPage can show which teachers carry one and let an admin edit it.
      ancienneteADeduire: snap.teacher.ancienneteADeduire,
      ancienneteADeduireNote: snap.teacher.ancienneteADeduireNote,
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

/**
 * Sets or clears a teacher's "ancienneté à déduire" correction (see Teacher.ancienneteADeduire's
 * doc comment) — a manual admin correction for career interruptions (disponibilité, congé longue
 * durée...) that the rectorat file's own "date d'accès à l'échelon" doesn't reflect. Recomputes
 * ComputedPromotionState immediately for every campagne this teacher has a snapshot in, so the
 * correction is visible right away rather than only after the next rectorat reimport.
 */
teachersRouter.put("/:id/anciennete-a-deduire", requireRole("ADMIN", "GESTIONNAIRE"), async (req, res) => {
  const { ancienneteADeduire, ancienneteADeduireNote } = req.body as {
    ancienneteADeduire?: string | null;
    ancienneteADeduireNote?: string | null;
  };

  const raw = ancienneteADeduire?.trim() || null;
  try {
    if (raw) parseAncienneteText(raw);
  } catch {
    return res.status(400).json({ error: `Format attendu "AAaMMmJJj" (ex. "01a06m00j"), reçu ${JSON.stringify(raw)}` });
  }

  const teacher = await prisma.teacher.findUnique({ where: { id: req.params.id }, include: { snapshots: true } });
  if (!teacher) return res.status(404).json({ error: "Enseignant introuvable" });

  await prisma.teacher.update({
    where: { id: req.params.id },
    data: { ancienneteADeduire: raw, ancienneteADeduireNote: ancienneteADeduireNote?.trim() || null },
  });

  const [liveGrilles, liveValeurDuPoint] = await Promise.all([loadLiveGrilles(), loadCurrentValeurDuPoint()]);
  const warnings: string[] = [];
  for (const snap of teacher.snapshots) {
    const { warning } = await recomputeAndStorePromotionState({
      teacherId: teacher.id,
      campagneId: snap.campagneId,
      grade: snap.grade,
      echelonActuel: snap.echelonActuel,
      dateAccesEchelon: snap.dateAccesEchelon,
      typePromotion: snap.typePromotion,
      dureeRestante: snap.dureeRestante,
      ancienneteADeduireRaw: raw,
      liveGrilles,
      liveValeurDuPoint,
    });
    if (warning) warnings.push(warning);
  }

  res.json({ ancienneteADeduire: raw, ancienneteADeduireNote: ancienneteADeduireNote?.trim() || null, warnings });
});
