/**
 * Estimates a person's civilité (Mme/M.) from their prénom alone, for the one case where we have
 * no declared value to go on: a non-adhérent teacher, who never gave the union a Civ. field (that
 * only exists on the adhérent side, from the ADEL export — see adherentCsvParser.ts). Per product
 * decision, this is always an estimation, never presented as a declared fact: a caller must keep
 * it visually distinct from Adherent.civilite (see routes/mailing.ts and MailingPage.tsx).
 *
 * The lookup table (civiliteTable.json) is generated from INSEE's public "Fichier des prénoms"
 * (every prénom declared in France since 1900, with a birth count per sexe) by
 * scripts/buildCiviliteTable.mjs — see that script's own comment for the generation rule and how
 * its 90% confidence threshold was picked. A genuinely epicene prénom (Dominique, Camille, Claude,
 * Alix, Morgan is NOT epicene enough to be excluded, etc.) is below that threshold and so resolves
 * to `null` ("non déterminé") here, never a wrong civilité on a real letter.
 */

import { normalizeName } from "./matching.js";
import civiliteTable from "./civiliteTable.json" with { type: "json" };

// The generated JSON's values are plain strings as far as TS's JSON-module inference goes — cast
// to the real, narrower shape (every value is actually "M" or "F", by construction in
// buildCiviliteTable.mjs).
const TABLE = civiliteTable as Record<string, "M" | "F">;

function lookupSex(prenom: string): "M" | "F" | null {
  return TABLE[normalizeName(prenom)] ?? null;
}

/**
 * Returns "Mme" / "M" (matching the token shape extractCivilite() already produces for adhérents —
 * see adherentCsvParser.ts and civilitePrefix() in mailing/template.ts) or null when the prénom
 * isn't a confident match. Falls back to just the first given name of a compound prénom ("Jean" out
 * of "Jean-Pierre", "Marie" out of "Marie Claire") when the full compound isn't itself listed.
 */
export function civiliteFromPrenom(prenom: string): "Mme" | "M" | null {
  const trimmed = prenom.trim();
  if (!trimmed) return null;

  const direct = lookupSex(trimmed);
  if (direct) return direct === "F" ? "Mme" : "M";

  const firstPart = trimmed.split(/[\s-]+/)[0];
  if (firstPart && firstPart !== trimmed) {
    const bySplit = lookupSex(firstPart);
    if (bySplit) return bySplit === "F" ? "Mme" : "M";
  }

  return null;
}
