import { describe, expect, it } from "vitest";
import { GRILLES, VALEUR_DU_POINT } from "@spelc/domain";
import { computeFuturePromotion } from "../src/mailing/futurePromotion.js";

describe("computeFuturePromotion", () => {
  it("projects one échelon further than the promotion this campagne already announces", () => {
    const result = computeFuturePromotion({
      grille: "AGR",
      echelonApresCettePromotion: "5",
      dateEffetCettePromotion: "2023-09-01",
      grilles: GRILLES,
      valeurDuPoint: VALEUR_DU_POINT,
    });
    // Échelon 5 isn't a BA window (only 6 and 8 are) — no accelerated variant.
    expect(result.dateFuturePromotion).toBe("2026-03-01");
    expect(result.dateFuturePromotionSiBA).toBeNull();
  });

  it("also returns a 1-year-earlier variant when landing on échelon 6 or 8 (a BA window)", () => {
    const result = computeFuturePromotion({
      grille: "AGR",
      echelonApresCettePromotion: "6",
      dateEffetCettePromotion: "2026-03-01",
      grilles: GRILLES,
      valeurDuPoint: VALEUR_DU_POINT,
    });
    expect(result.dateFuturePromotion).not.toBeNull();
    expect(result.dateFuturePromotionSiBA).not.toBeNull();
    const normal = new Date(result.dateFuturePromotion!);
    const accelerated = new Date(result.dateFuturePromotionSiBA!);
    expect(normal.getUTCFullYear() - accelerated.getUTCFullYear()).toBe(1);
    expect(normal.getUTCMonth()).toBe(accelerated.getUTCMonth());
    expect(normal.getUTCDate()).toBe(accelerated.getUTCDate());
  });

  it("accepts a full ISO datetime (e.g. Prisma's DateTime.toISOString()), not just a bare date", () => {
    const result = computeFuturePromotion({
      grille: "AGR",
      echelonApresCettePromotion: "5",
      dateEffetCettePromotion: "2023-09-01T00:00:00.000Z",
      grilles: GRILLES,
      valeurDuPoint: VALEUR_DU_POINT,
    });
    expect(result.dateFuturePromotion).toBe("2026-03-01");
  });

  it("returns null for both when the landing échelon is already the grille's ceiling", () => {
    const result = computeFuturePromotion({
      grille: "AGR",
      echelonApresCettePromotion: "11", // AGR's ceiling échelon (durée = MAX) — no further promotion
      dateEffetCettePromotion: "2026-03-01",
      grilles: GRILLES,
      valeurDuPoint: VALEUR_DU_POINT,
    });
    expect(result.dateFuturePromotion).toBeNull();
    expect(result.dateFuturePromotionSiBA).toBeNull();
  });
});
