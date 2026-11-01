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

/**
 * La décision effective de promotion pour une fiche : l'override manuel (`decisionManuelle`,
 * modifiable depuis l'onglet Mailing) prime sur le marqueur "Choix du Recteur" du fichier
 * rectorat (`choixRecteur`) quand il est présent — remplace l'ancienne comparaison rang <=
 * contingent (voir HcExcSnapshot.decisionManuelle's own doc comment). Prend un objet minimal
 * plutôt que le type Prisma complet pour rester appelable depuis n'importe quelle requête qui a
 * déjà chargé ces deux champs (routes/hcExc.ts, routes/hcExcMailing.ts), sans requête dédiée.
 */
export function decisionEffective(snap: { choixRecteur: boolean; decisionManuelle: boolean | null }): boolean {
  return snap.decisionManuelle ?? snap.choixRecteur;
}
