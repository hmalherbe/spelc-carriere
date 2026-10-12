/** Joins non-zero year/month/day components into French prose ("2 ans 8 mois"), dropping any
 * component that's zero. An all-zero duration renders as "0 jour" rather than an empty string. */
function formatYmdText(years: number, months: number, days: number): string {
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} an${years > 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} mois`);
  if (days > 0) parts.push(`${days} jour${days > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" ") : "0 jour";
}

/**
 * Formats the rectorat's packed "AAaMMmJJj" duration text (e.g. "01a01m21j", seen verbatim next to
 * the "RE." — report d'ancienneté — marker in the rectorat export) into French prose
 * ("1 an 1 mois 21 jours"). Returns null for null/unparseable input.
 */
export function formatDureeEncodedText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d+)a(\d+)m(\d+)j$/.exec(raw.trim());
  if (!m) return null;
  return formatYmdText(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Formats a decimal-year ancienneté figure (e.g. 2.706, as stored in TeacherSnapshot.ancienneteGrade
 * / ancienneteEchelon) the way the union's mail-merged letters show it: a French comma ("2,7 ans"),
 * NOT a years/months/days breakdown — reconstructed from the real sent CCMA mailing, which ruled out
 * an earlier Y/M/D version of this function.
 *
 * Rounded to 1 decimal digit (per product decision): the secondaire source already prints at most
 * 3 decimals, but the premier-degré (CCMI) source encodes ancienneté as années/mois/jours and goes
 * through ancienneteToBankingDays' 360-day conversion to land on this same decimal-years figure —
 * that division routinely produces long repeating decimals (e.g. 9.002777777777778) with no real
 * meaning beyond the 1st digit, which read as a display bug rather than precision. A value that
 * rounds to a whole number shows with no decimal at all (matches the existing whole-year case, e.g.
 * "2 ans"), same as the real letters never show a trailing ",0".
 *
 * Singular "an" below 2, plural "ans" from 2 up (checked against the ROUNDED value shown, not the
 * raw input, so a value that rounds up/down across the 2-year line pluralizes to match what's
 * actually printed).
 */
export function formatAnneesDecimalesText(years: number | null | undefined): string | null {
  if (years == null) return null;
  const fixed = years.toFixed(1);
  const rounded = Number(fixed);
  const formattedValue = Number.isInteger(rounded) ? String(rounded) : fixed.replace(".", ",");
  return `${formattedValue} an${rounded >= 2 ? "s" : ""}`;
}

/**
 * Every source (rectorat exports, ADEL) gives prénoms in ALL CAPS — this renders them "Marie",
 * "Jean-Baptiste", "Mamy Mirinah" for display, capitalizing the first letter after the start of the
 * string and after each space/hyphen/apostrophe, lowercasing everything else. Never applied to
 * NOM (kept as the source gives it — all caps is the conventional French "NOM Prénom" styling).
 * Shared by the web UI (every table/page showing a prénom) and the mailing templates (the
 * "<Prénom> <NOM>" header line in a sent e-mail) — one place, so both stay in sync.
 */
export function formatPrenom(prenom: string): string {
  return prenom.toLowerCase().replace(/(^|[ '-])([a-zà-ÿ])/g, (_, sep, letter) => sep + letter.toUpperCase());
}

/**
 * Strips a leading zero for display ("07" -> "7") — échelon is zero-padded as stored/filtered on
 * everywhere in the app (sorting, matching against the rectorat export, GRADE_MAPPINGS lookups...),
 * but reads oddly to a human as "07" instead of "7". Lettered échelons (hors-classe/classe
 * exceptionnelle codes like "A1") pass through unchanged. Shared by the web UI (every table/page
 * showing an échelon) and the mailing templates (every letter) — one place, so both stay in sync.
 */
export function formatEchelonLabel(echelon: string): string {
  const n = Number(echelon);
  return Number.isFinite(n) ? String(n) : echelon;
}
