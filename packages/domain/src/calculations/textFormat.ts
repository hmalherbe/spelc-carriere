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
 * / ancienneteEchelon) the same way the union's own mail-merged CCMA letters do: the raw decimal
 * value with a French comma ("2,706 ans"), NOT a years/months/days breakdown — confirmed against
 * the real sent mailing (e.g. "1,442 an", "12,997 ans"), which ruled out an earlier Y/M/D version
 * of this function.
 *
 * Singular "an" below 2, plural "ans" from 2 up. The real letters are themselves inconsistent in
 * the 1-2 range (the same 1,442 value shows up as both "an" and "ans" across different letters —
 * apparently two spreadsheet columns with slightly different rounding) — this picks the more common
 * of the two rather than trying to reproduce that inconsistency.
 */
export function formatAnneesDecimalesText(years: number | null | undefined): string | null {
  if (years == null) return null;
  const formattedValue = String(years).replace(".", ",");
  return `${formattedValue} an${years >= 2 ? "s" : ""}`;
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
