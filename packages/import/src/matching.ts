/**
 * Fuzzy nom/prénom matching between adhérents (union membership export) and teachers (rectorat
 * campaign snapshots) — ports the spirit of the workbook's `Table.FuzzyNestedJoin(..., {Nom,
 * Prénom}, ..., [IgnoreCase=true, IgnoreSpace=true])`, using Levenshtein-based similarity instead
 * of Power Query's internal algorithm (that internal algorithm isn't reproducible outside Power
 * Query, and per product decision this matching is inherently advisory — a confident match still
 * goes through a human review queue the first time, see @spelc/api's MatchCandidate model).
 */

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Mirrors the source workbook's IgnoreCase + IgnoreSpace fuzzy-join options, plus stripping
 * accents so "Stephanie"/"Stéphanie"-style discrepancies (the exact case the workbook hard-codes
 * a 45-entry dictionary for) don't tank the similarity score. */
export function normalizeName(s: string): string {
  return stripDiacritics(s)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[n];
}

/** 0 (nothing alike) to 1 (identical after normalization). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(na, nb) / maxLen;
}

export interface MatchCandidateTeacher {
  teacherId: string;
  nom: string;
  prenom: string;
}

export interface MatchCandidateAdherent {
  adherentId: string;
  nom: string;
  prenom: string;
}

export interface MatchResult {
  adherentId: string;
  teacherId: string | null;
  confidence: number;
  /** Auto-confirmable per product decision: a first-time link above this bar still lands in the
   * review queue as AUTO_CONFIRMED (no action needed) rather than PENDING_REVIEW — but it's the
   * link itself, once made, that's permanent, not this score. */
  autoConfirmable: boolean;
}

/** Above this combined score, treat nom+prénom as "the same person" without a human needing to
 * eyeball it — chosen conservatively (normalized edit-distance similarity, not a probability). */
const AUTO_CONFIRM_THRESHOLD = 0.92;

/**
 * Matches each adherent to at most one teacher among `teachers` (typically: everyone in the
 * current campaign not already linked to a confirmed MatchCandidate — filtering that out is the
 * caller's job, since it needs the DB). Combines nom and prénom similarity, weighting nom higher
 * since prénoms vary more in spelling/usage (nicknames, accents) without indicating a different
 * person.
 *
 * Assignment is global, not per-adherent: a teacher can only ever end up matched to one adherent
 * (MatchCandidate.teacherId is unique in the DB), so if two adherents' best guess both point at the
 * same free teacher, the higher-confidence pair wins that teacher and the other adherent gets no
 * candidate (teacherId: null) rather than a doomed duplicate — greedy highest-score-first, the
 * standard approximation for this kind of bipartite assignment.
 */
export function matchAdherents(adherents: MatchCandidateAdherent[], teachers: MatchCandidateTeacher[]): MatchResult[] {
  const pairs: { adherentId: string; teacherId: string; score: number }[] = [];
  for (const adherent of adherents) {
    for (const teacher of teachers) {
      const nomScore = nameSimilarity(adherent.nom, teacher.nom);
      const prenomScore = nameSimilarity(adherent.prenom, teacher.prenom);
      const score = nomScore * 0.6 + prenomScore * 0.4;
      if (score >= 0.4) pairs.push({ adherentId: adherent.adherentId, teacherId: teacher.teacherId, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const claimedAdherents = new Set<string>();
  const claimedTeachers = new Set<string>();
  const assignment = new Map<string, { teacherId: string; score: number }>();
  for (const pair of pairs) {
    if (claimedAdherents.has(pair.adherentId) || claimedTeachers.has(pair.teacherId)) continue;
    claimedAdherents.add(pair.adherentId);
    claimedTeachers.add(pair.teacherId);
    assignment.set(pair.adherentId, { teacherId: pair.teacherId, score: pair.score });
  }

  return adherents.map((adherent) => {
    const match = assignment.get(adherent.adherentId);
    if (!match) {
      return { adherentId: adherent.adherentId, teacherId: null, confidence: 0, autoConfirmable: false };
    }
    return {
      adherentId: adherent.adherentId,
      teacherId: match.teacherId,
      confidence: Math.round(match.score * 100) / 100,
      autoConfirmable: match.score >= AUTO_CONFIRM_THRESHOLD,
    };
  });
}
