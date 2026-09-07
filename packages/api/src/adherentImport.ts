import { prisma } from "./db.js";
import { matchAdherents, type AdherentRecord } from "@spelc/import";

export interface ImportAdherentRecordsResult {
  created: number;
  updated: number;
  matching: { autoConfirmed: number; pendingReview: number };
}

/**
 * Upserts adherent rows (keyed on nom+prénom — not identity-critical, since the Teacher<->Adherent
 * link reviewed by a human is what's authoritative) and runs the fuzzy matching engine for any
 * that don't already have a MatchCandidate. Shared by both adherent import paths — the manual CSV
 * upload and the ADEL scraper — so the upsert/matching logic only lives in one place.
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

  // Run matching only for adherents that don't already have a MatchCandidate — a confirmed or
  // even auto-confirmed/pending link from a previous import is never re-litigated here.
  const withoutCandidate = await prisma.adherent.findMany({
    where: { id: { in: adherentIds }, matchCandidate: null },
  });

  // A teacher can only ever be linked to one adherent (MatchCandidate.teacherId is unique in the
  // DB) — exclude anyone already claimed by an existing candidate (of any status: AUTO_CONFIRMED,
  // CONFIRMED, or even a still-open PENDING_REVIEW that already suggested them) from the pool, or
  // matchAdherents could propose an already-taken teacher and the insert below would fail.
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
    withoutCandidate.map((a) => ({ adherentId: a.id, nom: a.nom, prenom: a.prenom })),
    availableTeachers.map((t) => ({ teacherId: t.teacherId, nom: t.nomUsage, prenom: t.prenom })),
  );

  let autoConfirmed = 0;
  let pendingReview = 0;
  for (const m of matchResults) {
    await prisma.matchCandidate.create({
      data: {
        adherentId: m.adherentId,
        teacherId: m.teacherId,
        confidence: m.confidence,
        status: m.autoConfirmable ? "AUTO_CONFIRMED" : "PENDING_REVIEW",
      },
    });
    if (m.autoConfirmable) autoConfirmed++;
    else pendingReview++;
  }

  return { created, updated, matching: { autoConfirmed, pendingReview } };
}
