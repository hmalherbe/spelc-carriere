import { prisma } from "./db.js";
import { matchAdherents, normalizeGrade, type AdherentRecord } from "@spelc/import";

export interface ImportAdherentRecordsResult {
  created: number;
  updated: number;
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
 * A CONFIRMED or REJECTED candidate is never touched here — those are final, human-made decisions.
 * A same-grade PENDING_REVIEW suggestion is also left alone — a legitimate low-confidence match
 * genuinely awaiting review must never be silently swapped out from under whoever's looking at it.
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
      OR: [{ matchCandidate: null }, { matchCandidate: { status: "PENDING_REVIEW" } }],
    },
    select: {
      id: true,
      nom: true,
      prenom: true,
      grade: true,
      matchCandidate: {
        select: {
          teacherId: true,
          teacher: { select: { snapshots: { take: 1, orderBy: { dateAccesEchelon: "desc" }, select: { grade: true } } } },
        },
      },
    },
  });

  const toRetry = candidates.filter((a) => {
    const candidate = a.matchCandidate;
    if (!candidate || !candidate.teacherId) return true; // never attempted, or attempted and found nothing
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

  const allTeacherSnapshots = await prisma.teacherSnapshot.findMany({
    distinct: ["teacherId"],
    orderBy: { dateAccesEchelon: "desc" },
    select: { teacherId: true, nomUsage: true, prenom: true, grade: true },
  });
  const availableTeachers = allTeacherSnapshots.filter((t) => !claimedTeacherIds.has(t.teacherId));

  const matchResults = matchAdherents(
    toRetry.map((a) => ({ adherentId: a.id, nom: a.nom, prenom: a.prenom, grade: a.grade })),
    availableTeachers.map((t) => ({ teacherId: t.teacherId, nom: t.nomUsage, prenom: t.prenom, grade: t.grade })),
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
    const data = {
      teacherId: m.teacherId,
      confidence: m.confidence,
      status: (m.autoConfirmable ? "AUTO_CONFIRMED" : "PENDING_REVIEW") as "AUTO_CONFIRMED" | "PENDING_REVIEW",
    };
    await prisma.matchCandidate.upsert({
      where: { adherentId: m.adherentId },
      create: { adherentId: m.adherentId, ...data },
      update: data,
    });
    if (m.autoConfirmable) autoConfirmed++;
    else pendingReview++;
  }

  return { autoConfirmed, pendingReview };
}

/**
 * Upserts adherent rows (keyed on nom+prénom — not identity-critical, since the Teacher<->Adherent
 * link reviewed by a human is what's authoritative) and runs the fuzzy matching engine for the
 * ones just touched. Shared by both adherent import paths — the manual CSV upload and the ADEL
 * scraper — so the upsert/matching logic only lives in one place.
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

  // Whether an adherent is actually due this campaign (CCMA/CCMI-eligible) is filtered
  // downstream, at display time, against a specific campagne's period — see
  // adherentEligibility.ts and its use in routes/matches.ts and routes/adherents.ts — not here,
  // since matching itself is campagne-agnostic.
  const matching = await matchUnresolvedAdherents(adherentIds);

  return { created, updated, matching };
}
