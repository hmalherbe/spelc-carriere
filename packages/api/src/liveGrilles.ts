import { prisma } from "./db.js";
import { GRILLES, VALEUR_DU_POINT, type EchelonRow, type GrilleCode } from "@spelc/domain";

/**
 * Loads the current grille indiciaire from the database (an admin may have edited some indices —
 * see routes/grilles.ts) in the shape @spelc/domain's calculation functions expect, so an import
 * or a promotion computation reflects the live data rather than the built-in reference values.
 * Falls back to a grille's built-in rows if it isn't in the database for some reason (should not
 * happen once seeded, but keeps this resilient rather than throwing).
 */
export async function loadLiveGrilles(): Promise<Record<GrilleCode, EchelonRow[]>> {
  const grilles = await prisma.grille.findMany({ include: { rows: true } });
  const result = { ...GRILLES };
  for (const g of grilles) {
    if (g.rows.length === 0) continue;
    result[g.code as GrilleCode] = g.rows.map((r) => ({
      echelon: r.echelon,
      echelonSuivant: r.echelonSuivant,
      indice: r.indice,
      duree: r.dureeAnnees ?? "MAX",
      ...(r.dureeAlternative != null ? { dureeAvantVivier2: r.dureeAlternative } : {}),
    }));
  }
  return result;
}

/** Loads the current "valeur du point d'indice" from the database, falling back to the built-in
 * reference value if none has been seeded. */
export async function loadCurrentValeurDuPoint(): Promise<number> {
  const latest = await prisma.valeurDuPoint.findFirst({ orderBy: { applicableA: "desc" } });
  return latest?.valeur ?? VALEUR_DU_POINT;
}
