import { Router } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { computeAdherentEligibility } from "../adherentEligibility.js";
import { loadLiveGrilles } from "../liveGrilles.js";
import { GRADE_MAPPINGS, findEchelonRow, type GrilleCode } from "@spelc/domain";

export const adherentsRouter = Router();
adherentsRouter.use(requireAuth);

type EligibleAdherentRow = {
  adherentId: string;
  civilite: string | null;
  nom: string;
  prenom: string;
  nomNaissance: string | null;
  grade: string | null;
  ancienEchelon: string | null;
  statut: string | null;
  typeContrat: string | null;
  dateEffet: Date | null;
  degre: 1 | 2 | null;
  dateProchainePromotion: string | null;
  nonPresentDansRectorat: boolean;
  /** Correction manuelle "ancienneté à reporter" portée par la fiche Teacher déjà rapprochée, le
   * cas échéant (voir Teacher.ancienneteAReporter's own doc comment) — pas liée à cette campagne en
   * particulier (c'est un champ intrinsèque à l'enseignant), donc toujours disponible même quand
   * `nonPresentDansRectorat` est vrai (pas de fiche rectorat pour CETTE campagne, mais un
   * rapprochement et une correction d'une campagne antérieure peuvent très bien exister). */
  ancienneteAReporterTeacher: string | null;
};

/**
 * Every adherent due (CCMA/CCMI-eligible) for the given campagne — independent of matching status,
 * unlike /matches which only ever lists PENDING_REVIEW candidates. Flags whether each one is
 * actually backed by a rectorat snapshot for THIS campagne (`nonPresentDansRectorat`): a linked
 * teacher isn't enough on its own if that teacher's own rectorat data doesn't cover this specific
 * campagne (e.g. matched years ago, not re-imported since).
 *
 * A PENDING_REVIEW match still counts as "present" here as long as it carries a real teacherId with
 * a snapshot for this campagne — PENDING_REVIEW only means a human hasn't rubber-stamped the fuzzy
 * match yet, not that the underlying teacher link is wrong or that the rectorat doesn't have this
 * person. Real bug found this way: ABOUKASSEM Raghda (PLP, genuinely in the rectorat file) was
 * reported as absent from it purely because her match was still PENDING_REVIEW — an older version
 * of this check required CONFIRMED/AUTO_CONFIRMED, conflating "match reviewed by a human" with
 * "teacher present in the rectorat", and wrongly flagged the large majority of eligible adherents as
 * absent on a real campagne where most matches simply hadn't been manually reviewed yet. Only
 * REJECTED (a human explicitly declared the link wrong) is excluded — matches.ts's reject handler
 * sets that status without clearing teacherId, so it must be checked explicitly rather than inferred
 * from teacherId alone.
 *
 * Shared by GET /eligibles (JSON, for AdherentsEligiblesPage) and GET
 * /eligibles-non-presents.xlsx (Excel export) so the two never disagree on who counts as eligible
 * or present.
 */
async function computeEligibleAdherents(campagneId: string): Promise<EligibleAdherentRow[] | null> {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) return null;

  const adherents = await prisma.adherent.findMany({
    include: {
      matchCandidate: {
        include: {
          teacher: {
            include: {
              snapshots: { where: { campagneId }, take: 1 },
              computedStates: { where: { campagneId }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  return adherents
    .map((a) => {
      const eligibility = computeAdherentEligibility(a, campagne);
      if (!eligibility.eligible) return null;

      const snapshot = a.matchCandidate?.teacher?.snapshots[0];
      const presentDansRectorat = a.matchCandidate?.status !== "REJECTED" && a.matchCandidate?.teacherId != null && snapshot != null;

      // Once the rectorat actually has this person for this campagne, its own date is always the
      // right one to show — never the ADEL-based estimate computeAdherentEligibility produces from
      // the adhérent's own (possibly stale/approximate) ancienEchelon/dateEffet fields, which exists
      // only as a placeholder for someone NOT YET covered by any rectorat import. Same precedence
      // routes/teachers.ts already uses for a BA candidate: the rectorat's own confirmed marker
      // (TeacherSnapshot.dateProchainePromotionRectorat) first, since it can genuinely differ from a
      // generic duration-based projection (BA acceleration); the stored ComputedPromotionState
      // otherwise (already computed from the teacher's real dateAccesEchelon at import time). A real
      // null here (e.g. already at the grille's ceiling) is also correct to show as-is, never papered
      // over by falling back to the adhérent-side estimate.
      const computedState = a.matchCandidate?.teacher?.computedStates[0];
      const dateProchainePromotion = presentDansRectorat
        ? (snapshot?.dateProchainePromotionRectorat ?? computedState?.dateProchainePromotion ?? null)?.toISOString() ?? null
        : eligibility.dateProchainePromotion;

      return {
        adherentId: a.id,
        civilite: a.civilite,
        nom: a.nom,
        prenom: a.prenom,
        nomNaissance: a.nomNaissance,
        grade: a.grade,
        ancienEchelon: a.ancienEchelon,
        statut: a.statut,
        typeContrat: a.typeContrat,
        dateEffet: a.dateEffet,
        degre: eligibility.degre,
        dateProchainePromotion,
        nonPresentDansRectorat: !presentDansRectorat,
        ancienneteAReporterTeacher: a.matchCandidate?.teacher?.ancienneteAReporter ?? null,
      };
    })
    .filter((r): r is EligibleAdherentRow => r !== null);
}

adherentsRouter.get("/eligibles", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const rows = await computeEligibleAdherents(campagneId);
  if (!rows) return res.status(404).json({ error: "Campagne introuvable" });

  res.json(
    rows.map((r) => ({
      adherentId: r.adherentId,
      nom: r.nom,
      prenom: r.prenom,
      grade: r.grade,
      degre: r.degre,
      dateProchainePromotion: r.dateProchainePromotion,
      nonPresentDansRectorat: r.nonPresentDansRectorat,
    })),
  );
});

/**
 * The échelon's statutory duration ("durée avant le prochain échelon"), as stated by the grille
 * indiciaire for this adhérent's grade + échelon actuel — "DUREE_Echelon" in the Excel export below.
 * Purely a grille lookup (GRADE_MAPPINGS -> grille code, then the live grille's own row for this
 * échelon), nothing computed from the adhérent's own dates — distinct from dateProchainePromotion,
 * which also factors in the adhérent's dateEffet. Returns null when the grade/échelon can't be
 * mapped (same "don't guess" stance as computeAdherentEligibility's own try/catch).
 */
function dureeEchelonText(
  grade: string | null,
  ancienEchelon: string | null,
  liveGrilles: Record<GrilleCode, import("@spelc/domain").EchelonRow[]>,
): string | null {
  if (!grade || !ancienEchelon) return null;
  const mapping = GRADE_MAPPINGS.find((g) => g.grade.toUpperCase() === grade.trim().toUpperCase());
  if (!mapping) return null;
  try {
    const row = findEchelonRow(mapping.grille as GrilleCode, ancienEchelon, liveGrilles);
    return String(row.duree);
  } catch {
    return null;
  }
}

function formatDateFr(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("fr-FR");
}

/**
 * Excel export of eligible adherents NOT present in any rectorat file for this campagne (see
 * computeEligibleAdherents's own doc comment for what that means) — the list a gestionnaire needs
 * to chase down by hand (phone the académie, check a late/missing rectorat export, etc.), since the
 * app's own rectorat-driven workflow has nothing on them for this campagne.
 */
adherentsRouter.get("/eligibles-non-presents.xlsx", async (req, res) => {
  const campagneId = typeof req.query.campagneId === "string" ? req.query.campagneId : undefined;
  if (!campagneId) return res.status(400).json({ error: "campagneId requis" });

  const rows = await computeEligibleAdherents(campagneId);
  if (!rows) return res.status(404).json({ error: "Campagne introuvable" });

  const nonPresents = rows.filter((r) => r.nonPresentDansRectorat);
  const liveGrilles = await loadLiveGrilles();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Non présents rectorat");
  sheet.addRow([
    "Civilité",
    "Nom",
    "Prénom",
    "Nom de naissance",
    "Grade",
    "Ancien échelon",
    "Statut",
    "Type de contrat",
    "Date dernière promotion",
    "Ancienneté à reporter",
    "DUREE_Echelon",
    "Date prochaine promotion",
  ]).font = { bold: true };

  for (const r of nonPresents) {
    sheet.addRow([
      r.civilite ?? "",
      r.nom,
      r.prenom,
      r.nomNaissance ?? "",
      r.grade ?? "",
      r.ancienEchelon ?? "",
      r.statut ?? "",
      r.typeContrat ?? "",
      formatDateFr(r.dateEffet),
      r.ancienneteAReporterTeacher ?? "",
      dureeEchelonText(r.grade, r.ancienEchelon, liveGrilles) ?? "",
      formatDateFr(r.dateProchainePromotion),
    ]);
  }

  sheet.columns.forEach((col) => {
    let max = 10;
    for (const v of col.values ?? []) {
      if (v == null) continue;
      max = Math.max(max, String(v).length);
    }
    col.width = Math.min(max + 2, 40);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="adherents_eligibles_non_presents_rectorat.xlsx"`);
  // exceljs's .d.ts resolves ArrayBuffer/Buffer against a different @types/node install than ours,
  // so TS sees a structural mismatch even though this is the exact same runtime data (see the same
  // workaround in packages/import/src/adherentXlsxParser.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.send(Buffer.from(buffer as any));
});
