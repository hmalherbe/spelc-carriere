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
 * / ancienneteEchelon) into the same French "X an(s) Y mois Z jour(s)" prose, using the same
 * 360-day banking year the rest of the promotion engine uses (see calculations/anciennete.ts) so
 * the two stay consistent with each other.
 */
export function formatAnneesDecimalesText(years: number | null | undefined): string | null {
  if (years == null) return null;
  const totalDays = Math.round(years * 360);
  const y = Math.floor(totalDays / 360);
  const afterYears = totalDays % 360;
  const mo = Math.floor(afterYears / 30);
  const d = afterYears % 30;
  return formatYmdText(y, mo, d);
}
