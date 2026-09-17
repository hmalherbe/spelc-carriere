import { computeEchelonPromotion, type EchelonRow, type GrilleCode } from "@spelc/domain";

export interface FuturePromotionResult {
  dateFuturePromotion: string | null; // ISO
  /** Only set when the échelon this campagne's promotion lands on (échelon 6 or 8) opens a
   * bonification d'ancienneté window for the NEXT échelon change — null otherwise. */
  dateFuturePromotionSiBA: string | null; // ISO
}

/**
 * "One step further" than the promotion this campagne's letter already announces: from the
 * échelon the teacher is about to reach (`echelonApresCettePromotion`, effective
 * `dateEffetCettePromotion` — this campagne's own echelonSuivant/dateProchainePromotion), projects
 * the NEXT échelon change with the same promotion engine used everywhere else in the app.
 *
 * When that landing échelon is 6 or 8 (a bonification d'ancienneté window — see eligibility.ts's
 * EchelonBA), also returns a variant one year earlier: a BA grant there moves this next date up by
 * exactly a year, per the rule already documented on the Règles de gestion page (échelon 6→7 in 2
 * years instead of 3, échelon 8→9 in 2,5 years instead of 3,5 — both a 1-year acceleration).
 */
export function computeFuturePromotion(params: {
  grille: GrilleCode;
  echelonApresCettePromotion: string;
  dateEffetCettePromotion: string; // ISO — a full datetime (as Prisma's DateTime.toISOString() gives) is fine, only the date part is used
  grilles: Record<GrilleCode, EchelonRow[]>;
  valeurDuPoint: number;
}): FuturePromotionResult {
  const next = computeEchelonPromotion({
    grille: params.grille,
    echelonDepart: params.echelonApresCettePromotion,
    // computeEchelonPromotion's own addCalendarYMD does a naive "YYYY-MM-DD".split("-") — a full
    // ISO datetime (e.g. from Prisma's DateTime.toISOString()) would silently produce NaN/Invalid
    // Date, so always truncate to the date part here regardless of what the caller passed in.
    dateDernierChangementEchelon: params.dateEffetCettePromotion.slice(0, 10),
    grilles: params.grilles,
    valeurDuPoint: params.valeurDuPoint,
  });

  if (!next.dateProchainePromotion) return { dateFuturePromotion: null, dateFuturePromotionSiBA: null };

  const isBaWindow = params.echelonApresCettePromotion === "6" || params.echelonApresCettePromotion === "8";
  return {
    dateFuturePromotion: next.dateProchainePromotion,
    dateFuturePromotionSiBA: isBaWindow ? shiftYears(next.dateProchainePromotion, -1) : null,
  };
}

function shiftYears(isoDate: string, years: number): string {
  const d = new Date(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}
