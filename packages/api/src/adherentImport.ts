import { prisma } from "./db.js";
import { matchAdherents, type AdherentRecord } from "@spelc/import";

export interface ImportAdherentRecordsResult {
  created: number;
  updated: number;
  matching: { autoConfirmed: number; pendingReview: number };
}

/**
 * Runs fuzzy matching for every adherent that doesn't yet have a SUCCESSFUL candidate — either no
 * MatchCandidate row at all (never attempted), or a still-open PENDING_REVIEW one that found no
 * teacher (teacherId null). The latter matters because matching only ever sees the teachers
 * imported SO FAR: an adherent whose teacher hadn't been imported yet (rectorat file imported
 * after the adherent file, or in a later session) got "Aucune correspondance trouvée" and — before
 * this — stayed stuck there forever, since a MatchCandidate row (even a failed one) made every
 * later import skip it as "already handled". Retrying these costs nothing when nothing's changed
 * (still no match) and fixes exactly that case once the missing teacher does show up.
 *
 * A CONFIRMED, AUTO_CONFIRMED, or REJECTED candidate is never touched here — those are final,
 * human-relevant decisions (REJECTED included: a human already looked and said no, even if
 * teacherId is null on that row too).
 *
 * `adherentIds`, when given, restricts the retry to that set (used right after an adherent file
 * import — only the just-touched rows can possibly need it yet); omitted, it reconsiders every
 * stuck adherent in the DB (used after a rectorat import, since that's what actually changes the
 * pool of candidate teachers).
 */
export async function matchUnresolvedAdherents(adherentIds?: string[]): Promise<{ autoConfirmed: number; pendingReview: number }> {
  const toRetry = await prisma.adherent.findMany({
    where: {
      ...(adherentIds ? { id: { in: adherentIds } } : {}),
      OR: [{ matchCandidate: null }, { matchCandidate: { status: "PENDING_REVIEW", teacherId: null } }],
    },
    select: { id: true, nom: true, prenom: true },
  });

  if (toRetry.length === 0) return { autoConfirmed: 0, pendingReview: 0 };

  // A teacher can only ever be linked to one adherent (MatchCandidate.teacherId is unique in the
  // DB) — exclude anyone already claimed by an existing candidate (AUTO_CONFIRMED, CONFIRMED, or a
  // still-open PENDING_REVIEW that already suggested them) from the pool, or matchAdherents could
  // propose an already-taken teacher and the upsert below would fail.
  const claimedTeacherIds = new Set(
    (await prisma.matchCandidate.findMany({ where: { teacherId: { not: null } }, select: { teacherId: true } })).map(
      (m) => m.teacherId as string,
    ),
  );

  const allTeacherSnapshots = await prisma.teacherSnapshot.findMany({
    distinct: ["teacherId"],
    orderBy: { dateAccesEchelon: "desc" },
    select: { teacherId: true, nomUsage: true, prenom: true },
  });
  const availableTeachers = allTeacherSnapshots.filter((t) => !claimedTeacherIds.has(t.teacherId));

  const matchResults = matchAdherents(
    toRetry.map((a) => ({ adherentId: a.id, nom: a.nom, prenom: a.prenom })),
    availableTeachers.map((t) => ({ teacherId: t.teacherId, nom: t.nomUsage, prenom: t.prenom })),
  );

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
      mailAcademique: r.mailAcademique,
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
