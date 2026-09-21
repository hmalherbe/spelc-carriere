import { prisma } from "./db.js";
import { AVIS_LABELS, pointsAccesClasseExceptionnelle, GRADE_MAPPINGS } from "@spelc/domain";

type AvisBareme = "Excellent" | "Très satisfaisant" | "Satisfaisant" | "A consolider";
const AVIS_BAREME_VALUES: readonly AvisBareme[] = ["Excellent", "Très satisfaisant", "Satisfaisant", "A consolider"];

/**
 * The teacher's own most recent known "avis d'évaluation" (0-4, EVAECH in the rectorat's échelon
 * exports — see TeacherSnapshot.avisEvaluation), across every campagne they've ever appeared in —
 * not scoped to any one campagne, since this is a fact about the person, not about a specific
 * import. Returns null when nothing's known yet, or when the only known value is 0 ("Non
 * renseigné" — AVIS_LABELS still returns a label for it, but there's no bonification bracket for
 * "not rated" in the barème tables, so it can't feed pointsAccesClasseExceptionnelle either).
 */
export async function dernierAvisConnu(teacherId: string): Promise<AvisBareme | null> {
  const snap = await prisma.teacherSnapshot.findFirst({
    where: { teacherId, avisEvaluation: { not: null } },
    orderBy: { dateAccesEchelon: "desc" },
    select: { avisEvaluation: true },
  });
  if (snap?.avisEvaluation == null) return null;
  const label = AVIS_LABELS[snap.avisEvaluation];
  return (AVIS_BAREME_VALUES as readonly string[]).includes(label) ? (label as AvisBareme) : null;
}

function corpsFromGrille(grille: string): "agrege" | "autre" {
  return grille.includes("AGR") ? "agrege" : "autre";
}

/**
 * Computes and stores the Classe Exceptionnelle barème score for every EXC snapshot in a campagne
 * that doesn't already have one — Hors Classe snapshots always already have theirs straight from
 * the rectorat file (see hcExcBaremeParser.ts's module doc comment), so this only ever does
 * anything for a Classe Exceptionnelle campagne. Sourced from the teacher's own most recently known
 * avis (see `dernierAvisConnu`) rather than from anything in the Classe Exceptionnelle file itself,
 * which the rectorat doesn't provide — per explicit product decision (confirmed by the union: they
 * always computed this score themselves, even before this app existed, exactly the way the central
 * spreadsheet's own "Appréciation finale du recteur pour accès à la Classe Exceptionnelle" column
 * sources it from the adhérent's ADEL "Dernier avis carrière", which this app doesn't capture yet —
 * the teacher's own échelon-import avis is used here as the best available substitute).
 *
 * Left uncomputed (and counted in `nonCalcules`, not silently skipped) when the teacher has no
 * known avis yet, or — a known gap, see hcExcReclassement.ts's own doc comment — for an agrégé
 * candidate, whose Hors Classe échelon can be lettered (A1/A2/A3) rather than the plain number this
 * reads directly off the snapshot.
 */
export async function computeEtStockerBaremeExc(campagneId: string): Promise<{ calcules: number; nonCalcules: number }> {
  const snapshots = await prisma.hcExcSnapshot.findMany({
    where: { campagneId, totalBareme: null },
    select: { id: true, teacherId: true, grade: true, echelonActuel: true, ancienneteEchelon: true },
  });

  let calcules = 0;
  let nonCalcules = 0;
  for (const snap of snapshots) {
    const gradeMapping = GRADE_MAPPINGS.find((g) => g.grade === snap.grade);
    const echelonNumerique = /^\d+$/.test(snap.echelonActuel) ? Number(snap.echelonActuel) : null;
    const avis = await dernierAvisConnu(snap.teacherId);

    if (!avis || !gradeMapping || echelonNumerique === null || snap.ancienneteEchelon == null) {
      nonCalcules++;
      continue;
    }

    const totalBareme = pointsAccesClasseExceptionnelle(avis, corpsFromGrille(gradeMapping.grille), echelonNumerique, snap.ancienneteEchelon);
    await prisma.hcExcSnapshot.update({ where: { id: snap.id }, data: { totalBareme } });
    calcules++;
  }

  return { calcules, nonCalcules };
}

export interface ContingentCutline {
  contingent: number;
  rangDernierPromu: number | null;
  totalBaremeDernierPromu: number | null;
  promusTeacherIds: Set<string>;
}

/**
 * Who's actually promoted this cycle for a (campagne, grade[, vivier]) group: everyone whose rang
 * (the rectorat's own "LISTE PAR BAREME DECROISSANT" ranking — trusted as-is, never re-derived from
 * `totalBareme`, since the rectorat's own ranking is authoritative even where this app can only
 * approximate the score that produced it — see computeEtStockerBaremeExc) falls at or above the
 * contingent. `contingentAnnonce` (the rectorat's own official figure) wins over `contingentPropose`
 * (the union's own working estimate, used only until the rectorat publishes theirs) once set;
 * absent both, the contingent is 0 (nobody promoted yet — matches the central spreadsheet's own
 * "Rang du dernier promu" reading 0 for an unset contingent, rather than guessing a number).
 */
export async function computeContingentCutline(campagneId: string, grade: string, vivier: string | null): Promise<ContingentCutline> {
  // Prisma's compound-unique lookup syntax (`findUnique({ where: { campagneId_grade_vivier: {...} } })`)
  // doesn't accept `null` for a nullable key component (a Prisma client typing limitation, not a
  // real database one — Postgres itself allows it, per this table's own `@@unique` including a
  // nullable column) — `findFirst` with a plain equality filter has no such restriction and the
  // unique constraint guarantees at most one row matches anyway.
  const contingentRow = await prisma.contingent.findFirst({ where: { campagneId, grade, vivier } });
  const contingent = contingentRow?.contingentAnnonce ?? contingentRow?.contingentPropose ?? 0;

  const snapshots = await prisma.hcExcSnapshot.findMany({
    where: { campagneId, grade, vivier },
    orderBy: { rang: "asc" },
    select: { rang: true, totalBareme: true, teacherId: true },
  });

  const promus = snapshots.slice(0, contingent);
  const dernierPromu = promus[promus.length - 1];

  return {
    contingent,
    rangDernierPromu: dernierPromu?.rang ?? null,
    totalBaremeDernierPromu: dernierPromu?.totalBareme ?? null,
    promusTeacherIds: new Set(promus.map((p) => p.teacherId)),
  };
}
