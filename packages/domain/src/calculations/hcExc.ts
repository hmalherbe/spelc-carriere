import {
  POINTS_ANCIENNETE_EXC_AGREGES,
  POINTS_ANCIENNETE_EXC_CERTIFIES,
  POINTS_ANCIENNETE_HC,
  POINTS_BONIFICATION_EXC_AVIS_RECTEUR,
  POINTS_BONIFICATION_HC_AVIS_RECTEUR,
  type ReclassementRow,
} from "../data/refs.js";

/**
 * Excel VLOOKUP with approximate match (TRUE/omitted 4th arg): the table must be sorted ascending
 * by key, and this returns the row for the LARGEST key that is <= the lookup value — i.e. it finds
 * which bracket `key` falls into. Used for both the points tables and the reclassement tables,
 * which are exactly that: piecewise breakpoint tables.
 */
function vlookupApprox<T, K extends keyof T>(table: T[], keyField: K, key: number): T {
  let best: T | undefined;
  let bestKey = -Infinity;
  for (const row of table) {
    const rowKey = row[keyField] as number;
    if (rowKey <= key && rowKey > bestKey) {
      best = row;
      bestKey = rowKey;
    }
  }
  if (!best) {
    throw new Error(`Aucune ligne trouvée pour la clé ${key} dans la table de barème`);
  }
  return best;
}

/** échelon (9, 10 or 11) and ancienneté (in years, decimal) dans cet échelon, packed as échelon*10 + ancienneté — this is exactly how the spreadsheet keys its points-d'ancienneté lookup tables. */
export function ancienneteCle(echelon: number, ancienneteDansEchelon: number): number {
  return echelon * 10 + ancienneteDansEchelon;
}

/**
 * Total "barème" (points) for access to the hors classe: bonification from the recteur's avis
 * (different scale for 1er degré / 2nd degré) plus points d'ancienneté dans l'échelon actuel.
 */
export function pointsAccesHorsClasse(
  avis: "Excellent" | "Très satisfaisant" | "Satisfaisant" | "A consolider",
  degre: 1 | 2,
  echelon: number,
  ancienneteDansEchelon: number,
): number {
  const bonification = POINTS_BONIFICATION_HC_AVIS_RECTEUR.find((r) => r.avis === avis);
  if (!bonification) throw new Error(`Avis inconnu: ${avis}`);
  const pointsBonification = degre === 1 ? bonification.points1erDegre : bonification.points2ndDegre;
  const cle = ancienneteCle(echelon, ancienneteDansEchelon);
  const pointsAnciennete = vlookupApprox(POINTS_ANCIENNETE_HC, "cle", cle).points;
  return pointsBonification + pointsAnciennete;
}

/**
 * Total "barème" (points) for access to the classe exceptionnelle: bonification from the recteur's
 * avis (same scale for all corps) plus points d'ancienneté, on a corps-specific ancienneté scale
 * (agrégés use a different bracket table than certifiés/PLP/PEPS/professeurs des écoles HC).
 */
export function pointsAccesClasseExceptionnelle(
  avis: "Excellent" | "Très satisfaisant" | "Satisfaisant" | "A consolider",
  corps: "agrege" | "autre",
  echelon: number,
  ancienneteDansEchelon: number,
): number {
  const bonification = POINTS_BONIFICATION_EXC_AVIS_RECTEUR.find((r) => r.avis === avis);
  if (!bonification) throw new Error(`Avis inconnu: ${avis}`);
  const cle = ancienneteCle(echelon, ancienneteDansEchelon);
  const table = corps === "agrege" ? POINTS_ANCIENNETE_EXC_AGREGES : POINTS_ANCIENNETE_EXC_CERTIFIES;
  const pointsAnciennete = vlookupApprox(table, "cle", cle).points;
  return bonification.points + pointsAnciennete;
}

/**
 * Given an échelon+ancienneté in the OLD grille (packed as échelon*10+ancienneté, same convention
 * as `ancienneteCle`), finds which échelon the teacher lands on in the NEW grille after a grade
 * change (classe normale -> hors classe, or hors classe -> classe exceptionnelle), and whether
 * their ancienneté within that échelon carries over ("conservation ancienneté") or resets to zero.
 */
export function reclassement(table: ReclassementRow[], cle: number): ReclassementRow {
  return vlookupApprox(table, "cle", cle);
}
