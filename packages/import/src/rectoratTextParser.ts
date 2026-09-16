/**
 * Parses the plain text of a rectorat "AVANCEMENT D'ECHELON" PDF export (already extracted from
 * the PDF — see pdfText.ts) into structured records.
 *
 * The format is a fixed-width ASCII table, but real files have enough variation between records
 * (contractuels with no établissement, grades with/without a rendez-vous de carrière avis,
 * occasional encoding glitches turning "RE." into a mangled character) that strict column-position
 * parsing breaks constantly. Instead this parses per-record CHUNK (delimited by the
 * "!-----------!-------...-!" separator line that ends every record's barème block) using
 * targeted regexes for each token, and reports what it couldn't confidently extract rather than
 * throwing — a batch import should surface partial/uncertain rows for review, not die on one
 * malformed record.
 */

export interface ParsedTeacherRecord {
  nomUsage: string;
  prenom: string;
  dateNaissance: string | null; // ISO date
  rneEtablissement: string | null;
  typeEtablissement: string | null;
  nomEtablissement: string | null;
  codePostal: string | null;
  ville: string | null;
  disciplineCode: string | null;
  disciplineLibelle: string | null;
  echelonActuel: string; // from the section header, e.g. "07"
  dateAccesEchelon: string | null; // ISO date
  avisEvaluation: number | null; // 0-4
  ancienneteGrade: number | null; // "Z1AGRA"
  ancienneteEchelon: number | null; // "Z1ANEC"
  ageEncodedRectorat: string | null; // "Z2AGEA", raw "AAMMJJ" text — see parseZ2AGEA for interpretation
  typePromotion: string | null; // AN / CL / BA / RE, from the "durée restante" token
  dureeRestante: string | null; // raw "AAaMMmJJj" text
  dateProchainePromotionRectorat: string | null; // ISO date, as stated by the rectorat itself
  // The "TRACK.date" marker (e.g. "BA.18/07/2025") — distinct from typePromotion/dureeRestante
  // above (the record's own default/fallback track's remaining time): this is the rectorat's own
  // projection or determination for a specific mechanism, most often used for BA since it's a
  // competitive selection rather than a simple countdown. "Pro " prefixed ("Pro BA.18/07/2025")
  // means CONFIRMED/GRANTED this cycle; unprefixed ("BA.18/07/2025") means only ELIGIBLE — a
  // candidate whose selection isn't decided yet. Verified against real files: "Pro" = "Promu".
  proTypePromotion: "AN" | "CL" | "BA" | null;
  proConfirmee: boolean; // true only when the marker above was "Pro "-prefixed
  /** Fields this parser could not confidently extract for this record — surface these for manual review rather than silently guessing. */
  warnings: string[];
}

/**
 * Per-échelon-section summary line ("NOMBRE DE PROMUS : <BA> <AN>") — the rectorat's own count of
 * how many candidates actually cleared each mechanism this cycle. This is the ground truth for
 * "how many BA promotions happened on this page": a per-record marker ("Pro"-prefixed or not)
 * turns out NOT to reliably distinguish confirmed-promoted from merely-eligible for BA (verified
 * against a real file: two candidates with no "Pro" prefix on their BA marker were still exactly
 * the section's "NOMBRE DE PROMUS" count for BA) — so ranking every BA candidate in a section by
 * barème (see rankBACandidates in @spelc/domain) and taking this many from the top is the reliable
 * way to know who was actually promoted.
 */
export interface RectoratSectionSummary {
  echelon: string;
  nombrePromusBA: number | null;
  nombrePromusAN: number | null;
}

export interface ParsedRectoratFile {
  gradeCode: string; // e.g. "4531"
  gradeLabel: string; // e.g. "ECR PROFESSEUR CERTIFIE CL. NORMALE"
  periodeDebut: string | null; // ISO date
  periodeFin: string | null; // ISO date
  records: ParsedTeacherRecord[];
  sections: RectoratSectionSummary[];
}

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})/;
const RNE_RE = /\b(\d{7}[A-Z])\b/;
const DUREE_RESTANTE_RE = /\b(AN|CL|BA|RE)\.\s*(\d{2}a\d{2}m\d{2}j)\b/;
const PRO_DATE_RE = /\b(Pro\s+)?(AN|CL|BA)\.(\d{2}\/\d{2}\/\d{4})\b/;
const DISCIPLINE_CODE_RE = /\b(\d{4}[A-Z])\s+/;
// The token that normally follows the discipline libellé: "AN."/"CL."/"BA."/"RE." (sometimes
// corrupted by an OCR/encoding glitch into a single mangled character — still 1-2 chars + "."),
// optionally followed by the "AAaMMmJJj" duree. Stripped from the END of the libellé tail rather
// than required as part of the same match, so a corrupted marker doesn't also destroy the
// (perfectly legible) discipline name right before it.
const TRAILING_PROMO_MARKER_RE = /\s*\S{1,2}\.(?:\s*\d{2}a\d{2}m\d{2}j)?\s*$/;
const AVIS_LINE_RE = /\b([0-4])\s+(EXCELLENT|TRES SATIS|SATIS|A CONSOLID|NON RENS)\b/;
// The section footer's "NOMBRE DE PROMUS" line: two counts, BA then AN, in that column order
// (matches both the "B A   A N" and "BA      AN" header-row spellings seen across real exports).
const PROMUS_FOOTER_RE = /NOMBRE DE PROMUS\s*:?\s*(\d+)\s+(\d+)/;
const BAREME_LINE_RE = /!\s*EVAECH\s*(\d)?\s*!\s*Z1AGRA\s+([\d.]+)\s*!\s*Z1ANEC\s+([\d.]+)\s*!\s*Z2AGEA\s+(\d{6})\s*!/;
// Établissement type codes as they appear in the rectorat exports (collège/lycée/lycée pro/etc.)
const TYPE_ETAB_RE = /\b(CLG|LGT|LG|LPO|LP|LT|LYT|ECS|SEP)\s+(PR|CC)\b/;

function toIsoDate(jjmmaaaa: string): string | null {
  const m = DATE_RE.exec(jjmmaaaa);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function toNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses one file's worth of text (all pages concatenated) into records, grouped by the échelon
 * header that precedes each section — the rectorat export groups people by "échelon actuel", it's
 * not a per-row field.
 */
export function parseRectoratFile(rawText: string): ParsedRectoratFile {
  const gradeMatch = /(\d{4})\s*:\s*(ECR[^\n]+)/.exec(rawText);
  const periodeMatch = /DU\s+(\d{2}\/\d{2}\/\d{4})[\s\S]*?AU\s+(\d{2}\/\d{2}\/\d{4})/.exec(rawText);

  const records: ParsedTeacherRecord[] = [];
  // Keyed by échelon rather than pushed per chunk: the same "ECHELON : NN" section can span
  // several physical PDF pages (repeating the header on each), with the summary footer appearing
  // only once, after the LAST chunk — so a later chunk's footer (if found) overwrites an earlier
  // chunk's absence of one, and every chunk for the same échelon converges on one summary.
  const sectionsByEchelon = new Map<string, RectoratSectionSummary>();

  // Split the text on "ECHELON : NN" headers, keeping track of which échelon each following
  // chunk of records belongs to.
  const echelonSections = rawText.split(/ECHELON\s*:\s*(\d{2})/).slice(1);
  for (let i = 0; i < echelonSections.length; i += 2) {
    const echelon = echelonSections[i];
    const sectionText = echelonSections[i + 1] ?? "";
    records.push(...parseSectionRecords(sectionText, echelon));

    const promusMatch = PROMUS_FOOTER_RE.exec(sectionText);
    if (promusMatch) {
      sectionsByEchelon.set(echelon, { echelon, nombrePromusBA: Number(promusMatch[1]), nombrePromusAN: Number(promusMatch[2]) });
    } else if (!sectionsByEchelon.has(echelon)) {
      sectionsByEchelon.set(echelon, { echelon, nombrePromusBA: null, nombrePromusAN: null });
    }
  }

  return {
    gradeCode: gradeMatch?.[1] ?? "",
    gradeLabel: gradeMatch?.[2]?.trim() ?? "",
    periodeDebut: periodeMatch ? toIsoDate(periodeMatch[1]) : null,
    periodeFin: periodeMatch ? toIsoDate(periodeMatch[2]) : null,
    records,
    sections: Array.from(sectionsByEchelon.values()),
  };
}

function parseSectionRecords(sectionText: string, echelon: string): ParsedTeacherRecord[] {
  // Stop at "NOMBRE DE PROMOUVABLES" — everything after that is the section's summary footer, not
  // another record.
  const body = sectionText.split(/NOMBRE DE PROMOUVABLES/)[0];

  // Both the section's table-header separator and each record's end-of-barème separator are a
  // full line made only of "!" and "-" (e.g. "!----...----!" or "!-----------!---...---!"). Every
  // such line is a safe split point: it never carries real content, whether it's a structural
  // header rule or a record boundary.
  const chunks = body.split(/^[!-]{10,}\s*$/m).map((c) => c.trim());

  const out: ParsedTeacherRecord[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const record = parseRecordChunk(chunk, echelon);
    if (record) out.push(record);
  }
  return out;
}

function parseRecordChunk(chunk: string, echelon: string): ParsedTeacherRecord | null {
  // Each record chunk starts with a lone "! !" blank-marker line before the actual NOM line —
  // drop it (and it alone; don't strip further blank lines, since a genuinely établissement-less
  // record has a meaningful blank line 3 that other indexing below relies on being present).
  const rawLines = chunk.split("\n").map((l) => l.trim());
  const lines = rawLines[0] === "! !" || rawLines[0] === "!" ? rawLines.slice(1) : rawLines;
  const warnings: string[] = [];

  // Line 1 (person/affectation line): "!NOM ... RNE TYPE_ETAB DATE [Pro TYPE.DATE]"
  const line1 = lines[0] ?? "";
  const nomMatch = /^!\s*([A-ZÀ-Ý' -]+?)\s{2,}/.exec(line1) ?? /^!\s*([A-ZÀ-Ý' -]+?)\s+\d/.exec(line1);
  const nomUsage = nomMatch?.[1]?.trim() ?? "";
  if (!nomUsage) warnings.push("Nom introuvable sur la ligne 1");

  const rneMatch = RNE_RE.exec(line1);
  const typeEtabMatch = TYPE_ETAB_RE.exec(line1);
  const dateAccesMatch = DATE_RE.exec(line1);

  // Line 2 (prénom/naissance/établissement/discipline line) — strip the leading "!" the fixed-width
  // table wraps every content line in before matching against the start of the string.
  const line2 = (lines[1] ?? "").replace(/^!/, "").trim();
  const prenomMatch = /^([A-ZÀ-Ý' -]+?)\s+\d{2}\/\d{2}\/\d{4}/.exec(line2);
  const prenom = prenomMatch?.[1]?.trim() ?? "";
  if (!prenom) warnings.push("Prénom introuvable sur la ligne 2");

  const dobMatch = DATE_RE.exec(line2);
  const dureeMatch = DUREE_RESTANTE_RE.exec(line2) ?? DUREE_RESTANTE_RE.exec(chunk);
  if (!dureeMatch) warnings.push("Durée restante illisible (probable glitch d'encodage sur le type de promotion)");

  // Discipline code anchors the rest of line 2: everything between the date of birth and the code
  // is the établissement name; everything after the code, once the (possibly corrupted) trailing
  // promotion-type marker is stripped, is the discipline libellé.
  const disciplineCodeMatch = DISCIPLINE_CODE_RE.exec(line2);
  let nomEtablissement: string | null = null;
  let disciplineLibelle: string | null = null;
  if (disciplineCodeMatch) {
    if (dobMatch) {
      const afterDob = line2.slice(dobMatch.index + dobMatch[0].length, disciplineCodeMatch.index);
      nomEtablissement = afterDob.trim() || null;
    }
    const tail = line2.slice(disciplineCodeMatch.index + disciplineCodeMatch[0].length).replace(/!\s*$/, "");
    disciplineLibelle = tail.replace(TRAILING_PROMO_MARKER_RE, "").trim() || null;
  } else {
    warnings.push("Discipline introuvable sur la ligne 2");
  }

  // Line 3 (code postal/ville, avis, or the "Pro TYPE.DATE" for non-avis grades)
  const line3 = (lines[2] ?? "").replace(/^!/, "").trim();
  const cpVilleMatch = /^(\d{5})\s+(.+)$/.exec(line3);
  const ville = cpVilleMatch ? cpVilleMatch[2].replace(/\s*!?\s*$/, "").replace(PRO_DATE_RE, "").trim() : null;
  const avisMatch = AVIS_LINE_RE.exec(line3);
  const proDateMatch = PRO_DATE_RE.exec(line1) ?? PRO_DATE_RE.exec(line3);

  // Barème line: "! ! EVAECH [n] ! Z1AGRA x.xxx ! Z1ANEC x.xxx ! Z2AGEA yymmdd ! ! !"
  const baremeLine = lines.find((l) => l.includes("EVAECH")) ?? "";
  const baremeMatch = BAREME_LINE_RE.exec(baremeLine);
  if (!baremeMatch) warnings.push("Bloc barème (EVAECH/Z1AGRA/Z1ANEC/Z2AGEA) illisible");

  if (!nomUsage && !prenom) {
    // Nothing usable in this chunk at all — not a real record (e.g. trailing whitespace/footer).
    return null;
  }

  return {
    nomUsage,
    prenom,
    dateNaissance: dobMatch ? toIsoDate(dobMatch[0]) : null,
    rneEtablissement: rneMatch?.[1] ?? null,
    typeEtablissement: typeEtabMatch ? `${typeEtabMatch[1]} ${typeEtabMatch[2]}` : null,
    nomEtablissement,
    codePostal: cpVilleMatch?.[1] ?? null,
    ville,
    disciplineCode: disciplineCodeMatch?.[1] ?? null,
    disciplineLibelle,
    echelonActuel: echelon,
    dateAccesEchelon: dateAccesMatch ? toIsoDate(dateAccesMatch[0]) : null,
    avisEvaluation: avisMatch ? Number(avisMatch[1]) : null,
    ancienneteGrade: toNumber(baremeMatch?.[2]),
    ancienneteEchelon: toNumber(baremeMatch?.[3]),
    ageEncodedRectorat: baremeMatch?.[4] ?? null,
    typePromotion: dureeMatch?.[1] ?? null,
    dureeRestante: dureeMatch?.[2] ?? null,
    dateProchainePromotionRectorat: proDateMatch ? toIsoDate(proDateMatch[3]) : null,
    proTypePromotion: (proDateMatch?.[2] as "AN" | "CL" | "BA" | undefined) ?? null,
    proConfirmee: proDateMatch ? proDateMatch[1] !== undefined : false,
    warnings,
  };
}

/**
 * Interprets the rectorat's "Z2AGEA" encoding: NOT a date, but the teacher's age at the campaign's
 * reference date, packed as AAMMJJ (years/months/days) — verified against a real example (born
 * 30/04/1995, Z2AGEA=290402 = 29 years 4 months 2 days as of 01/09/2024).
 */
export function parseZ2AGEA(raw: string): { annees: number; mois: number; jours: number } {
  return {
    annees: Number(raw.slice(0, 2)),
    mois: Number(raw.slice(2, 4)),
    jours: Number(raw.slice(4, 6)),
  };
}
