import { prisma } from "./db.js";
import { matchAdherents, normalizeGrade, DEFAULT_MIN_SUGGESTION_THRESHOLD, type AdherentRecord } from "@spelc/import";

export interface ImportAdherentRecordsResult {
  created: number;
  updated: number;
  /** Adherent rows deleted because they no longer appeared in this import — someone who left the
   * union since the last sync. See importAdherentRecords's own doc comment. */
  deleted: number;
  matching: { autoConfirmed: number; pendingReview: number };
}

/**
 * Runs fuzzy matching for every adherent that doesn't yet have a SUCCESSFUL, still-trustworthy
 * candidate — no MatchCandidate row at all (never attempted), a still-open PENDING_REVIEW one that
 * found no teacher (teacherId null), or a still-open PENDING_REVIEW one whose suggested teacher's
 * grade no longer matches the adherent's own grade (a suggestion made before grade became part of
 * the matching rule — see matching.ts — genuinely stale, not a legitimate call awaiting review).
 *
 * The teacherId-null case matters because matching only ever sees the teachers imported SO FAR: an
 * adherent whose teacher hadn't been imported yet (rectorat file imported after the adherent file,
 * or in a later session) got "Aucune correspondance trouvée" and — before this function existed —
 * stayed stuck there forever, since a MatchCandidate row (even a failed one) made every later
 * import skip it as "already handled". The grade-mismatch case matters for the same reason applied
 * retroactively: a suggestion proposed while matching only compared names can point at someone of
 * a completely different grade (a real case: an adhérent CERTIFIE HC suggested a teacher AGREGE) —
 * that's not a borderline call for a human to weigh, it's simply wrong, so it's cleared here rather
 * than left sitting in the review queue. Retrying costs nothing when nothing's changed.
 *
 * A CONFIRMED candidate is never touched here — a human positively identified this as the right
 * teacher, which must never be silently swapped out from under them. AUTO_CONFIRMED is different:
 * it's the algorithm's own call (an unambiguous name match, nobody ever reviewed it), so it's just
 * as eligible for the same staleness retry as PENDING_REVIEW — real case: ABOUKASSEM Raghda (PLP),
 * AUTO_CONFIRMED to a Teacher row that had since lost every snapshot (the same duplicate-identity
 * situation the ATAYAN Lianna case below already handles, just never reachable for her because the
 * query here used to only pick up PENDING_REVIEW/null, leaving her stuck on a dead link forever — no
 * review queue entry either, since AUTO_CONFIRMED never appears there). A same-grade PENDING_REVIEW
 * suggestion is left alone — a legitimate low-confidence match genuinely awaiting review must never
 * be silently swapped out from under whoever's looking at it.
 *
 * REJECTED is retried too, always (not just when stale) — it records "this specific teacher wasn't
 * the right one", not "never match this adherent again": the enum's own doc comment says as much
 * ("adherent has no linked teacher yet"). Real case found this way: on one campagne, 75 of 171
 * eligible adherents were REJECTED, almost all of them the exact same duplicate-Teacher-row pattern
 * as ABOUKASSEM Raghda above, just one step further — a human had already looked at the stale
 * suggestion and (correctly, at the time) said "not this one", which then made the status permanent
 * and invisible to every later reimport that created the teacher's real, current Teacher row. Still
 * never silently re-establishes the SAME rejected pairing, though: `rejectedTeacherIdByAdherent`
 * below downgrades a fresh result back to "no match" if it would just propose the identical teacherId
 * a human already rejected, forcing a human decision again (via the review queue) rather than
 * overriding them automatically.
 *
 * `adherentIds`, when given, restricts the retry to that set (used right after an adherent file
 * import — only the just-touched rows can possibly need it yet); omitted, it reconsiders every
 * stuck or stale adherent in the DB (used after a rectorat import, since that's what actually
 * changes the pool of candidate teachers).
 */
export async function matchUnresolvedAdherents(adherentIds?: string[]): Promise<{ autoConfirmed: number; pendingReview: number }> {
  const candidates = await prisma.adherent.findMany({
    where: {
      ...(adherentIds ? { id: { in: adherentIds } } : {}),
      OR: [
        { matchCandidate: null },
        { matchCandidate: { status: "PENDING_REVIEW" } },
        { matchCandidate: { status: "AUTO_CONFIRMED" } },
        { matchCandidate: { status: "REJECTED" } },
      ],
    },
    select: {
      id: true,
      nom: true,
      prenom: true,
      grade: true,
      matchCandidate: {
        select: {
          status: true,
          teacherId: true,
          teacher: { select: { snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" }, select: { grade: true } } } },
        },
      },
    },
  });

  const toRetry = candidates.filter((a) => {
    const candidate = a.matchCandidate;
    if (!candidate) return true; // never attempted
    if (candidate.status === "REJECTED") return true; // always worth a fresh attempt — see doc comment above
    if (!candidate.teacherId) return true; // attempted and found nothing
    const suggestedGrade = candidate.teacher?.snapshots[0]?.grade;
    // The suggested teacher has no snapshot at all anymore — e.g. a corrected rectorat re-import
    // wholesale-replaced their (campagne, grade)'s fiches and the new file no longer lists them.
    // That's never a real suggestion to leave sitting in the queue (real case: ATAYAN Lianna,
    // shown "Aucune correspondance trouvée" — teacherId null-checks pass — while still carrying a
    // stale confidence/teacherId from before that teacher's only snapshot was deleted, leaving
    // "Confirmer" wrongly enabled) — always worth retrying, unlike a genuine grade mismatch below.
    if (!suggestedGrade) return true;
    if (!a.grade) return false; // adherent's own grade unknown — can't judge, leave the existing suggestion as-is
    return normalizeGrade(a.grade) !== normalizeGrade(suggestedGrade); // stale cross-grade suggestion
  });

  if (toRetry.length === 0) return { autoConfirmed: 0, pendingReview: 0 };

  const retryIds = new Set(toRetry.map((a) => a.id));

  // The specific teacherId each REJECTED adherent was explicitly told "not this one" about — a
  // fresh match result must never silently re-propose exactly this pairing (see doc comment above).
  const rejectedTeacherIdByAdherent = new Map<string, string>();
  for (const a of toRetry) {
    if (a.matchCandidate?.status === "REJECTED" && a.matchCandidate.teacherId) {
      rejectedTeacherIdByAdherent.set(a.id, a.matchCandidate.teacherId);
    }
  }

  // A teacher can only ever be linked to one adherent (MatchCandidate.teacherId is unique in the
  // DB) — exclude anyone already claimed by an existing candidate outside this retry batch
  // (AUTO_CONFIRMED, CONFIRMED, or a still-open, still-valid PENDING_REVIEW) from the pool, or
  // matchAdherents could propose an already-taken teacher and the upsert below would fail. A
  // candidate INSIDE this batch does NOT count as claiming its (possibly stale) teacher: that hold
  // is exactly what's being re-evaluated, and must not block the retry from re-proposing that same
  // teacher (correctly, this time) to whichever adherent actually matches them.
  const claimedTeacherIds = new Set(
    (
      await prisma.matchCandidate.findMany({
        where: { teacherId: { not: null }, adherentId: { notIn: [...retryIds] } },
        select: { teacherId: true },
      })
    ).map((m) => m.teacherId as string),
  );

  // The candidate pool spans both rectorat processes a Teacher row can come from: échelon-
  // advancement (TeacherSnapshot) and Hors Classe/Classe Exceptionnelle (HcExcSnapshot) — a
  // teacher imported ONLY via an HC/EXC file (never yet seen in a CCMA échelon export) must still
  // be a matchable candidate, or that entire import would never let its teachers link to an
  // adhérent. Distinct per (teacherId, grade): unlike TeacherSnapshot's history-across-campagnes
  // dedup, a teacher genuinely CAN legitimately appear under two different grades here at once
  // (e.g. "PEPS" from an échelon campagne and "PEPS HC" from a Hors Classe one, mid-promotion) —
  // both are real, distinct matching candidates, not duplicates of each other.
  const [allTeacherSnapshots, allHcExcSnapshots] = await Promise.all([
    prisma.teacherSnapshot.findMany({
      distinct: ["teacherId"],
      orderBy: { dateAccesEchelon: "desc" },
      select: { teacherId: true, nomUsage: true, prenom: true, grade: true },
    }),
    prisma.hcExcSnapshot.findMany({
      distinct: ["teacherId", "grade"],
      select: { teacherId: true, nomUsage: true, prenom: true, grade: true },
    }),
  ]);
  const allTeachers = [...allTeacherSnapshots, ...allHcExcSnapshots];
  const availableTeachers = allTeachers.filter((t) => !claimedTeacherIds.has(t.teacherId));

  const matchingConfig = await prisma.matchingConfig.findUnique({ where: { id: "singleton" } });

  const matchResults = matchAdherents(
    toRetry.map((a) => ({ adherentId: a.id, nom: a.nom, prenom: a.prenom, grade: a.grade })),
    availableTeachers.map((t) => ({ teacherId: t.teacherId, nom: t.nomUsage, prenom: t.prenom, grade: t.grade })),
    matchingConfig?.minSuggestionThreshold ?? DEFAULT_MIN_SUGGESTION_THRESHOLD,
  );

  // matchAdherents() never proposes the same teacher twice WITHIN matchResults (see its own
  // greedy claiming), but two adherents in this batch can still need to swap teachers — adherent A
  // moving off a stale teacherId that adherent B's result now needs. Upserting sequentially hits a
  // transient unique-constraint conflict on `teacherId` the moment B's write lands before A's old
  // row has been cleared, even though the FINAL state (after every row settles) is perfectly valid.
  // Real case: a large re-import surfaced enough stale cross-grade suggestions at once (see the
  // ATAYAN Lianna / stale-suggestion comment above) that two of them happened to need each other's
  // teacher, crashing every retry attempt on the same pair. Clearing every retried row's teacherId
  // first — a bulk update, not upserts, so it can't itself collide with anything — means no row in
  // the batch can still be "holding" a teacherId by the time the per-row upserts below run.
  await prisma.matchCandidate.updateMany({
    where: { adherentId: { in: [...retryIds] }, teacherId: { not: null } },
    data: { teacherId: null },
  });

  let autoConfirmed = 0;
  let pendingReview = 0;
  for (const m of matchResults) {
    // Re-finding the exact teacher a human already rejected for this adherent is never a new
    // decision to auto-apply — fall back to "no match", same shape matchAdherents() itself uses,
    // so it surfaces in the review queue for an actual human call instead.
    const rejectedTeacherId = rejectedTeacherIdByAdherent.get(m.adherentId);
    const result = rejectedTeacherId && m.teacherId === rejectedTeacherId ? { teacherId: null, confidence: 0, autoConfirmable: false } : m;

    const data = {
      teacherId: result.teacherId,
      confidence: result.confidence,
      status: (result.autoConfirmable ? "AUTO_CONFIRMED" : "PENDING_REVIEW") as "AUTO_CONFIRMED" | "PENDING_REVIEW",
    };
    await prisma.matchCandidate.upsert({
      where: { adherentId: m.adherentId },
      create: { adherentId: m.adherentId, ...data },
      update: data,
    });
    if (result.autoConfirmable) autoConfirmed++;
    else pendingReview++;
  }

  return { autoConfirmed, pendingReview };
}

/**
 * Clears the suggested teacher (teacherId -> null, confidence -> 0, same shape matchAdherents()
 * itself uses for "no candidate found") on every still-open PENDING_REVIEW candidate whose stored
 * confidence no longer clears the currently configured MatchingConfig.minSuggestionThreshold.
 *
 * matchUnresolvedAdherents() above deliberately never touches a same-grade PENDING_REVIEW candidate
 * that already has a suggested teacher — by design, so a suggestion genuinely awaiting a human's
 * review is never silently swapped out from under them. That's the right call for an ordinary
 * reimport, but it also means raising minSuggestionThreshold in Paramètres has NO effect on
 * whatever's already sitting in the queue: real case, an admin raised the threshold from 43% to 75%
 * specifically to clear out coincidental-overlap noise (e.g. "ADANERO Olivia" suggested against
 * "BARBERO Florian", 43%) and found those exact rows still there afterwards. This is the explicit,
 * separate cleanup step for that — only ever run when an admin asks for it (the "Recalculer les
 * rapprochements" button), and it only ever REMOVES a suggestion (never proposes a replacement, so
 * it can't introduce a new wrong pairing) — a confirmed/rejected candidate is never touched, same as
 * matchUnresolvedAdherents().
 */
export async function purgeStaleLowConfidenceMatches(): Promise<{ cleared: number }> {
  const matchingConfig = await prisma.matchingConfig.findUnique({ where: { id: "singleton" } });
  const threshold = matchingConfig?.minSuggestionThreshold ?? DEFAULT_MIN_SUGGESTION_THRESHOLD;

  const { count } = await prisma.matchCandidate.updateMany({
    where: { status: "PENDING_REVIEW", teacherId: { not: null }, confidence: { lt: threshold } },
    data: { teacherId: null, confidence: 0 },
  });

  return { cleared: count };
}

/**
 * Upserts adherent rows (keyed on nom+prénom — not identity-critical, since the Teacher<->Adherent
 * link reviewed by a human is what's authoritative) and runs the fuzzy matching engine for the
 * ones just touched. Shared by both adherent import paths — the manual CSV upload and the ADEL
 * scraper — so the upsert/matching logic only lives in one place.
 *
 * `records` is trusted to be the union's ENTIRE current roster, not a partial/incremental list —
 * true for both callers (the automatic ADEL sync and the manual fallback, which ImportPage.tsx's
 * own copy already describes as "exporte l'annuaire des adhérents", the whole directory). Any
 * existing Adherent not present in it this time has therefore left the union since the last
 * import/sync and is deleted outright — its MatchCandidate (a required, non-nullable relation) is
 * deleted first to satisfy the foreign key; MailingLog.adherentId is a plain historical string, not
 * a real FK (same pattern as sentById/triggeredById elsewhere in this schema), so past mailing
 * history for that person is untouched. No partial-file safety net by product decision: an admin
 * uploading a filtered/incomplete file by mistake would deactivate real members with no warning —
 * accepted because both import paths are always expected to carry the full roster.
 */
export async function importAdherentRecords(records: AdherentRecord[]): Promise<ImportAdherentRecordsResult> {
  let created = 0;
  let updated = 0;
  const adherentIds: string[] = [];
  for (const r of records) {
    const key = { nom: r.nom, prenom: r.prenom };
    const existing = await prisma.adherent.findFirst({ where: key });
    const data = {
      civilite: r.civilite,
      nom: r.nom,
      prenom: r.prenom,
      nomNaissance: r.nomNaissance,
      grade: r.grade,
      ancienEchelon: r.ancienEchelon,
      statut: r.statut,
      typeContrat: r.typeContrat,
      ancienIndice: r.ancienIndice,
      dateEffet: r.dateEffet ? new Date(r.dateEffet) : null,
      mailPersonnel: r.mailPersonnel,
      departement: r.departement,
    };
    if (existing) {
      await prisma.adherent.update({ where: { id: existing.id }, data });
      adherentIds.push(existing.id);
      updated++;
    } else {
      const created_ = await prisma.adherent.create({ data });
      adherentIds.push(created_.id);
      created++;
    }
  }

  // An empty `records` (a genuinely empty or unparseable file) is never "the union now has zero
  // members" — skip pruning rather than let `notIn: []` match, and delete, every adherent in the
  // database.
  let staleIds: string[] = [];
  if (adherentIds.length > 0) {
    const stale = await prisma.adherent.findMany({ where: { id: { notIn: adherentIds } }, select: { id: true } });
    staleIds = stale.map((a) => a.id);
    if (staleIds.length > 0) {
      await prisma.matchCandidate.deleteMany({ where: { adherentId: { in: staleIds } } });
      await prisma.adherent.deleteMany({ where: { id: { in: staleIds } } });
    }
  }

  // Whether an adherent is actually due this campaign (CCMA/CCMI-eligible) is filtered
  // downstream, at display time, against a specific campagne's period — see
  // adherentEligibility.ts and its use in routes/matches.ts and routes/adherents.ts — not here,
  // since matching itself is campagne-agnostic.
  const matching = await matchUnresolvedAdherents(adherentIds);

  return { created, updated, deleted: staleIds.length, matching };
}
