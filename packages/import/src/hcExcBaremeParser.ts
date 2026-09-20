/**
 * Parses the rectorat's "TABLEAU AVANCEMENT" text (already extracted from the PDF — see
 * pdfText.ts) into structured records — the barème-ranked, contingent-capped promotion process
 * for Hors Classe / Classe Exceptionnelle. Structurally unrelated to rectoratTextParser.ts, which
 * handles the échelon-advancement PROJECTION format: here the rectorat hands over a ready-made
 * rank ("Ordre") within a "LISTE PAR BAREME DECROISSANT" list, and the union decides who's
 * actually promoted by comparing that rank against a contingent (see @spelc/api's Contingent
 * model) — no duration/date computation involved on the union's side for the ranking itself.
 *
 * Two sub-formats have been observed in real files, both handled here without the caller needing
 * to know which one a given file is:
 *   - Hors Classe: each record ends in a single numeric tail line (Appréciation Recteur, Points
 *     Recteur, Points d'ancienneté, Total barème, an optional "P" Choix du Recteur marker,
 *     Millésime, Origine) — the rectorat already computed and printed the barème score.
 *   - Classe Exceptionnelle: no numeric barème tail at all — instead a "P"/blank Choix du Recteur
 *     marker, a Vivier 1 eligibility flag, and two long free-text paragraphs (Avis CE from the
 *     chef d'établissement, Avis IPR from the inspecteur). The rectorat does NOT hand over a
 *     ready-made point total for this process — computing one (see pointsAccesClasseExceptionnelle
 *     in @spelc/domain) is the union's own job, same as it always was pre-2024-reform; this parser
 *     only extracts what the file actually states.
 */

export interface ParsedHcExcRecord {
  rang: number;
  nomUsage: string;
  prenom: string;
  nomNaissance: string | null;
  dateNaissance: string | null; // ISO date
  disciplineLibelle: string | null;
  nomEtablissement: string | null;
  rneEtablissement: string | null;
  echelonActuel: string | null;
  // "Ech. barème" in the source — the échelon this record's barème was actually computed against,
  // which can differ from échelonActuel (a teacher due an automatic échelon change before the
  // campagne's reference date is scored on the échelon they'll be AT, not the one they're
  // currently on) — kept separate rather than overwriting échelonActuel.
  echelonBareme: string | null;
  ancienneteEchelonTexte: string | null; // raw "AAaMMmJJj", the "A :" value
  ancienneteBaremeTexte: string | null; // raw "AAaMMmJJj", the "Anc :" value
  modeAccesCorps: string | null;
  dateAccesCorps: string | null; // ISO date
  ancienneteCorpsTexte: string | null; // raw "AAaMMmJJj"
  // Hors Classe only (see module doc comment) — null for a Classe Exceptionnelle record, since
  // the rectorat's file doesn't state one.
  appreciationRecteur: string | null;
  pointsRecteur: number | null;
  pointsAnciennete: number | null;
  totalBareme: number | null;
  millesime: number | null;
  origine: string | null;
  // Classe Exceptionnelle only — null for a Hors Classe record, since the rectorat's file doesn't
  // carry these at all for that process.
  avisCE: string | null;
  avisInspecteur: string | null;
  // Both processes: "P" printed next to this record means the rectorat itself already flagged it
  // chosen — kept as its own signal, separate from the union's own contingent-cutline decision
  // (computed downstream, not by this parser).
  choixRecteur: boolean;
  /** Fields this parser could not confidently extract for this record — surface these for manual review rather than silently guessing. */
  warnings: string[];
}

export interface ParsedHcExcFile {
  /** From "ACADEMIE : NICE TABLEAU AVANCEMENT->HORS CLASSE PROF.EPS" — "HORS CLASSE" or "CLASSE EXCEPTIONNELLE". */
  processus: string | null;
  /** The grade label as printed by the rectorat, e.g. "PROF.EPS" — raw, for the caller to map. */
  gradeLabel: string | null;
  annee: number | null;
  /** Present only for a Classe Exceptionnelle file whose header states which vivier it lists. */
  vivier: string | null;
  records: ParsedHcExcRecord[];
}

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})/;
const ANCIENNETE_RE = /\d{2}a\d{2}m\d{2}j/;
// A name-block line: starts with an uppercase (possibly accented) letter, then any run of
// uppercase letters/spaces/apostrophes/hyphens — matches how the rectorat prints NOM/PRENOM in
// this export (always upper case, unlike the "AVANCEMENT D'ECHELON" format's mixed case).
const NAME_LINE = "[A-ZÀ-Ü][A-ZÀ-Ü '\\-]*";
// A record boundary: a bare "Ordre" integer on its own line, then 2 to 4 name-shaped lines (the
// normal case is exactly 3: Nom d'usage / Prénom / Nom naissance — but a long or hyphenated
// surname sometimes wraps onto its own extra line in the PDF's text extraction, real case: "DE
// BEVY" + "MARTINEZ" for "DE BEVY-MARTINEZ"), then a date of birth. Deliberately permissive
// (2-4 lines) rather than exactly 3, so a wrapped name still gets its own record instead of
// silently vanishing (merged into the previous record's tail, or simply unmatched) — the price is
// that a 4-line block can't always be split unambiguously into nom/prénom/nom naissance, flagged
// with a warning below rather than guessed at with false confidence.
// Up to 6 raw lines before hyphen-joining (see joinHyphenWrappedLines) — real files have shown a
// double-hyphenated surname wrap across 3 lines on its own ("BONNET-SAINT-GEORGES" as "BONNET-" /
// "SAINT-" / "GEORGES"), which alone already accounts for 5 of the 2-4-line block's usual slots.
const RECORD_START_RE = new RegExp(`^(\\d+)\\n((?:${NAME_LINE}\\n){2,6})(\\d{2}\\/\\d{2}\\/\\d{4})`, "gm");

function toIsoDate(jjmmaaaa: string): string | null {
  const m = DATE_RE.exec(jjmmaaaa);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** A hyphenated compound name (e.g. "BONNET-SAINT-GEORGES") that wraps at the hyphen keeps the
 * hyphen at the end of each broken-off line in the extracted text (real case: "BONNET-" / "SAINT-"
 * / "GEORGES", three separate lines) — a reliable, unambiguous signal to rejoin, unlike a wrap at
 * a plain space (see splitNameBlock's fallback for that case, which can't be resolved this
 * cleanly). Applied before line-counting, so a hyphen-wrapped name collapses back to one line and
 * no longer needs the fallback heuristic below at all. */
function joinHyphenWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.endsWith("-")) {
      out[out.length - 1] = prev + line;
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Splits the captured name block into nom/prénom/nom naissance. Exactly 3 lines (after
 * hyphen-joining) is the unambiguous, overwhelmingly common case. More than 3 means one of the
 * three still wraps onto an extra line at a plain space rather than a hyphen (real case: nom de
 * naissance "DELAGE AGNELLI" repeating both the nom d'usage's two wrapped lines) — which line
 * wrapped can't be told apart reliably from line count alone, so this makes the same best-effort
 * assumption every time (extra lines belong to the NOM, the field most likely to be long/compound
 * of the three) and always flags it for a human to verify, rather than silently guessing with
 * false confidence. */
function splitNameBlock(block: string, warnings: string[]): { nomUsage: string; prenom: string; nomNaissance: string | null } {
  const lines = joinHyphenWrappedLines(block.split("\n").filter((l) => l.length > 0));
  if (lines.length === 3) {
    return { nomUsage: lines[0], prenom: lines[1], nomNaissance: lines[2] };
  }
  // A nom de naissance identical to (and as multi-line as) the nom d'usage wraps symmetrically —
  // real case: "DELAGE" / "AGNELLI" / "ALEXANDRA" / "DELAGE" / "AGNELLI", where the surname
  // "DELAGE AGNELLI" is simply repeated as both fields. Unlike the generic fallback below, this
  // pattern IS unambiguous (the two halves match exactly), so it's resolved with confidence and no
  // warning rather than folded into the "best guess" path.
  if (lines.length >= 5 && lines.length % 2 === 1) {
    const half = (lines.length - 1) / 2;
    const nomLines = lines.slice(0, half);
    if (nomLines.join("\u0000") === lines.slice(half + 1).join("\u0000")) {
      return { nomUsage: nomLines.join(" "), prenom: lines[half], nomNaissance: nomLines.join(" ") };
    }
  }
  if (lines.length >= 4) {
    warnings.push("Nom sur plusieurs lignes (probable nom composé) — assemblage automatique à vérifier");
    return { nomUsage: lines.slice(0, -2).join(" "), prenom: lines[lines.length - 2], nomNaissance: lines[lines.length - 1] };
  }
  warnings.push(`Bloc nom/prénom inattendu (${lines.length} ligne(s)) — à vérifier`);
  return { nomUsage: lines.join(" "), prenom: lines[lines.length - 1] ?? "", nomNaissance: null };
}

/** "Excellent" / "Très satisfaisant" / "Satisfaisant" / "A consolider" — the last two words can
 * appear wrapped onto two lines in the extracted text (e.g. "Très\nsatisfaisant"), collapsed here
 * to match on a single normalized line. */
const APPRECIATION_RE = /(Excellent|Tr[eè]s\s+satisfaisant|Satisfaisant|A\s+consolider)/;
// The Hors Classe tail line, once whitespace-normalized: appréciation, 3 numbers (points recteur,
// points ancienneté, total barème — the last printed with pointless trailing ".000", not a real
// decimal), an optional "P" (choix du recteur), a 4-digit millésime, then origine (a short code
// like "SIAE"/"TA HC").
const HC_TAIL_RE = new RegExp(`${APPRECIATION_RE.source}\\s+(\\d+)\\s+(\\d+)\\s+([\\d.]+)\\s*(P)?\\s*(\\d{4})\\s+(\\S+)`);

function parseRecordChunk(rang: number, nameBlock: string, dobRaw: string, rest: string): ParsedHcExcRecord {
  const warnings: string[] = [];
  const { nomUsage, prenom, nomNaissance } = splitNameBlock(nameBlock, warnings);

  const rneMatch = /RNE:\s*(\S+)/.exec(rest);
  const echelonActuelMatch = /Ech\.\s*actuel\s*:\s*(\d+)/.exec(rest);
  const echelonBaremeMatch = /Ech\.\s*bar[eè]me\s*:\s*(\d+)/.exec(rest);
  // "A :" (ancienneté échelon) anchored to the start of a line so it never matches the "MA :"
  // (mode d'accès) line right after it — that "A" is never the first character of its own line.
  const ancienneteEchelonMatch = new RegExp(`^A\\s*:\\s*(${ANCIENNETE_RE.source})`, "m").exec(rest);
  const ancienneteBaremeMatch = new RegExp(`Anc\\s*:\\s*(${ANCIENNETE_RE.source})`).exec(rest);

  if (!rneMatch) warnings.push("RNE introuvable");
  if (!echelonActuelMatch) warnings.push("Échelon actuel introuvable");
  if (!ancienneteEchelonMatch) warnings.push("Ancienneté dans l'échelon introuvable");

  // Discipline + établissement sit between the date of birth and the RNE line, with no reliable
  // delimiter between the two in the flattened text — kept as one combined block (still useful for
  // display/search) rather than force a split with false confidence; flagged so a reviewer knows
  // it wasn't separated.
  let disciplineLibelle: string | null = null;
  let nomEtablissement: string | null = null;
  if (rneMatch) {
    const beforeRne = rest.slice(0, rneMatch.index).trim();
    const lines = beforeRne
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      disciplineLibelle = lines.join(" ");
      nomEtablissement = disciplineLibelle;
      warnings.push("Discipline et établissement non séparés (pas de délimiteur fiable dans le fichier source)");
    }
  }

  // "Mode d'accès au corps" block: the mode text (1+ wrapped lines) followed by the access date,
  // then the ancienneté corps value — sometimes on the same line as the date, sometimes the next.
  let modeAccesCorps: string | null = null;
  let dateAccesCorps: string | null = null;
  let ancienneteCorpsTexte: string | null = null;
  const modeAccesIdx = rest.search(/Mode d'acc[eè]s au corps/);
  if (modeAccesIdx !== -1) {
    const afterLabel = rest.slice(modeAccesIdx + "Mode d'accès au corps".length);
    const dateInModeMatch = DATE_RE.exec(afterLabel);
    if (dateInModeMatch) {
      modeAccesCorps = afterLabel
        .slice(0, dateInModeMatch.index)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .trim() || null;
      dateAccesCorps = toIsoDate(dateInModeMatch[0]);
      const ancMatch = new RegExp(ANCIENNETE_RE.source).exec(afterLabel.slice(dateInModeMatch.index + dateInModeMatch[0].length));
      ancienneteCorpsTexte = ancMatch?.[0] ?? null;
    }
  }

  // Tail: either the Hors Classe numeric barème line, or the Classe Exceptionnelle
  // "P"/blank + avis CE/IPR free text — mutually exclusive, detected by which marker is present.
  const avisCeIdx = rest.search(/Avis CE\s*:/);
  let appreciationRecteur: string | null = null;
  let pointsRecteur: number | null = null;
  let pointsAnciennete: number | null = null;
  let totalBareme: number | null = null;
  let millesime: number | null = null;
  let origine: string | null = null;
  let avisCE: string | null = null;
  let avisInspecteur: string | null = null;
  let choixRecteur = false;

  if (avisCeIdx !== -1) {
    // Classe Exceptionnelle shape.
    const avisIprIdx = rest.search(/Avis IPR\s*:/);
    avisCE = rest
      .slice(avisCeIdx + "Avis CE :".length, avisIprIdx !== -1 ? avisIprIdx : undefined)
      .replace(/\s+/g, " ")
      .trim() || null;
    if (avisIprIdx !== -1) {
      avisInspecteur = rest
        .slice(avisIprIdx + "Avis IPR :".length)
        .replace(/\s+/g, " ")
        .trim() || null;
    }
    const beforeAvis = rest.slice(0, avisCeIdx);
    choixRecteur = /\bP\s+[NY]\s*$/.test(beforeAvis.trimEnd()) || /\bP\s*\n/.test(beforeAvis.slice(-20));
  } else {
    // Hors Classe shape: search the tail of the chunk (after the last known anchor) for the
    // numeric barème line, normalizing newlines to spaces first so a wrapped "Très\nsatisfaisant"
    // still matches as one appréciation.
    const tailStart = ancienneteCorpsTexte ? rest.indexOf(ancienneteCorpsTexte) + ancienneteCorpsTexte.length : 0;
    const tailNormalized = rest.slice(tailStart).replace(/\s+/g, " ").trim();
    const tailMatch = HC_TAIL_RE.exec(tailNormalized);
    if (tailMatch) {
      appreciationRecteur = tailMatch[1].replace(/\s+/g, " ");
      pointsRecteur = Number(tailMatch[2]);
      pointsAnciennete = Number(tailMatch[3]);
      totalBareme = Math.round(Number(tailMatch[4]));
      choixRecteur = tailMatch[5] === "P";
      millesime = Number(tailMatch[6]);
      origine = tailMatch[7];
    } else {
      warnings.push("Ligne de barème (appréciation/points/millésime) illisible");
    }
  }

  return {
    rang,
    nomUsage,
    prenom,
    nomNaissance,
    dateNaissance: toIsoDate(dobRaw),
    disciplineLibelle,
    nomEtablissement,
    rneEtablissement: rneMatch?.[1] ?? null,
    echelonActuel: echelonActuelMatch?.[1] ?? null,
    echelonBareme: echelonBaremeMatch?.[1] ?? null,
    ancienneteEchelonTexte: ancienneteEchelonMatch?.[1] ?? null,
    ancienneteBaremeTexte: ancienneteBaremeMatch?.[1] ?? null,
    modeAccesCorps,
    dateAccesCorps,
    ancienneteCorpsTexte,
    appreciationRecteur,
    pointsRecteur,
    pointsAnciennete,
    totalBareme,
    millesime,
    origine,
    avisCE,
    avisInspecteur,
    choixRecteur,
    warnings,
  };
}

/** The "TABLEAU AVANCEMENT->..." title has been observed in both orders — "HORS CLASSE PROF.EPS"
 * (process first) and "PEPS CLASSE EXC" (grade first) — so this pulls out the process by its own
 * known keywords rather than assuming a fixed position, and treats whatever's left as the grade
 * label. */
function parseProcessusEtGrade(titleText: string): { processus: string | null; gradeLabel: string | null } {
  if (/HORS CLASSE/.test(titleText)) {
    return { processus: "HORS CLASSE", gradeLabel: titleText.replace(/HORS CLASSE/, "").trim() || null };
  }
  if (/CLASSE EXC(?:EPTIONNELLE)?/.test(titleText)) {
    return {
      processus: "CLASSE EXCEPTIONNELLE",
      gradeLabel: titleText.replace(/CLASSE EXC(?:EPTIONNELLE)?/, "").trim() || null,
    };
  }
  return { processus: null, gradeLabel: titleText.trim() || null };
}

export function parseHcExcBaremeFile(rawText: string): ParsedHcExcFile {
  // The "->" arrow between "AVANCEMENT" and the process/grade title varies across real files
  // ("->", "-->", or even just "-", sometimes with no following space) — matched loosely rather
  // than assuming one exact spelling.
  const titleMatch = /ACADEMIE\s*:\s*NICE\s+TABLEAU AVANCEMENT-+>?\s*(.+?)\s+DATE\s*:/.exec(rawText);
  const { processus, gradeLabel } = titleMatch ? parseProcessusEtGrade(titleMatch[1]) : { processus: null, gradeLabel: null };
  const anneeMatch = /ANNEE\s*:\s*(\d{4})/.exec(rawText);
  const vivierMatch = /^Vivier\s+([12])\s*$/m.exec(rawText);

  const starts = [...rawText.matchAll(RECORD_START_RE)];
  const records: ParsedHcExcRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const rang = Number(m[1]);
    const nameBlock = m[2];
    const dobRaw = m[3];
    const chunkStart = m.index! + m[0].length;
    const chunkEnd = i + 1 < starts.length ? starts[i + 1].index! : rawText.indexOf("ACADEMIE :", chunkStart);
    const rest = rawText.slice(chunkStart, chunkEnd === -1 ? rawText.length : chunkEnd);
    records.push(parseRecordChunk(rang, nameBlock, dobRaw, rest));
  }

  return {
    processus,
    gradeLabel,
    annee: anneeMatch ? Number(anneeMatch[1]) : null,
    vivier: vivierMatch ? `Vivier ${vivierMatch[1]}` : null,
    records,
  };
}
