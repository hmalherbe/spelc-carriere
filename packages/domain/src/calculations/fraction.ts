/** Reduces a positive-denominator fraction to its irreducible form (via Euclid's GCD) — used to
 * display the exact "coefficient de reclassement" applied to a service (reclassementConcours.ts)
 * as a fraction rather than a decimal approximation. */
export function simplifierFraction(numerateur: number, denominateur: number): { numerateur: number; denominateur: number } {
  if (denominateur === 0) {
    throw new Error("Dénominateur nul");
  }
  const diviseur = pgcd(Math.abs(numerateur), Math.abs(denominateur)) || 1;
  const signe = denominateur < 0 ? -1 : 1;
  return { numerateur: (signe * numerateur) / diviseur, denominateur: (signe * denominateur) / diviseur };
}

function pgcd(a: number, b: number): number {
  return b === 0 ? a : pgcd(b, a % b);
}
