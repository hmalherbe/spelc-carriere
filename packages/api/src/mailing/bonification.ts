import type { BonificationState } from "./ccmaModelTemplate.js";

/**
 * Derives the CCMA model letter's 3-state "Bonification" field from the raw rectorat markers —
 * see ccmaModelTemplate.ts's CcmaModelContext doc comment for what each state means.
 *
 * A CONFIRMED marker ("Pro TYPE.date", proConfirmee=true) always wins, regardless of typePromotion:
 * a teacher can carry typePromotion="BA" (they were a candidate at some point) yet end up confirmed
 * "Pro AN." instead — their normal-duration échelon change got decided, making the BA candidacy
 * moot — which reads as ANCIENNETE, not NON_PROMU. Verified against the real 25 mars 2026 CCMA
 * mailing: checking typePromotion alone (ignoring which type actually got confirmed) got the
 * bonification state right for only 68.5% of the 336 real, cross-referenced candidates; this rule
 * gets 99.4% (334/336) — the 2 remaining are BA grants confirmed at the CCMA meeting itself, later
 * than this file's own "PROJET D'AVANCEMENT" export date, so genuinely not decidable from this file
 * alone (see ccmaModelTemplate.ts's CCMA-only guard for the same kind of unavoidable data gap).
 *
 * reliquatPromu (see schema.prisma's ReliquatPromotion) counts exactly like proConfirmee=true — a
 * BA granted via the union's own "reliquat" mechanism after the rectorat file was established,
 * never carrying a "Pro BA." marker at all (real case: Yann ADAM, 25 mars 2026 campagne).
 */
export function deriveBonification(snap: {
  typePromotion: string | null;
  proTypePromotion: string | null;
  proConfirmee: boolean;
  reliquatPromu?: boolean;
}): BonificationState {
  if (snap.proConfirmee || snap.reliquatPromu) return snap.proTypePromotion === "BA" ? "BONIFICATION" : "ANCIENNETE";
  return snap.typePromotion === "BA" || snap.proTypePromotion === "BA" ? "NON_PROMU" : "ANCIENNETE";
}
