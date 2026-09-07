import type { AncienneteYMD } from "../types.js";

/**
 * Parses the "XXaYYmZZj" ancienneté format used both by the rectorat PDF exports
 * (e.g. "00a04m24j", "01a00m00j") and by the central spreadsheet's
 * "Ancienneté à déduire" / "Ancienneté à reporter" columns.
 * Returns null for an empty/missing value (no ancienneté to add/subtract).
 */
export function parseAncienneteText(text: string | null | undefined): AncienneteYMD | null {
  if (!text) return null;
  const m = /^(\d{2})a(\d{2})m(\d{2})j$/.exec(text.trim());
  if (!m) {
    throw new Error(`Format d'ancienneté inattendu: ${JSON.stringify(text)} (attendu "AAaMMmJJj")`);
  }
  return { annees: Number(m[1]), mois: Number(m[2]), jours: Number(m[3]) };
}

/**
 * Converts a Y/M/D ancienneté duration into a number of days on the 360-day banking calendar
 * (12 months of 30 days each) that French administrative HR services use for échelon durations —
 * this is NOT real calendar days.
 * Mirrors: jours + 30*mois + 360*annees
 */
export function ancienneteToBankingDays(a: AncienneteYMD | null | undefined): number {
  if (!a) return 0;
  return a.jours + 30 * a.mois + 360 * a.annees;
}

/**
 * Splits a number of 360-day-calendar days back into years/months/days.
 * Mirrors: INT(jours/360) ; INT((jours-360*annees)/30) ; jours-360*annees-30*mois
 */
export function bankingDaysToYMD(totalDays: number): AncienneteYMD {
  const annees = Math.trunc(totalDays / 360);
  const mois = Math.trunc((totalDays - 360 * annees) / 30);
  const jours = totalDays - 360 * annees - 30 * mois;
  return { annees, mois, jours };
}

/**
 * Adds a Y/M/D offset to an ISO date using REAL calendar arithmetic (not the 360-day banking
 * calendar) — this matches Excel's DATE(year+dy, month+dm, day+dd), which normalizes overflowing
 * months/days the same way the JS Date constructor does.
 */
export function addCalendarYMD(isoDate: string, offset: AncienneteYMD): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y + offset.annees, m - 1 + offset.mois, d + offset.jours));
  return date.toISOString().slice(0, 10);
}
