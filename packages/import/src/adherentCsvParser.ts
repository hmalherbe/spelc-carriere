/**
 * Parses the union's membership export ("ADEL Etat Jasper Export Excel", saved as CSV) into
 * adherent records. The source has one header row; header text is normalized (case, whitespace,
 * embedded line breaks — the original workbook's column names span multiple lines) so this
 * survives minor formatting drift between export runs.
 */

export interface AdherentRecord {
  civilite: string | null;
  nom: string;
  prenom: string;
  nomNaissance: string | null;
  grade: string | null;
  ancienEchelon: string | null;
  statut: string | null;
  typeContrat: string | null;
  ancienIndice: number | null;
  dateEffet: string | null; // ISO date
  mailPersonnel: string | null;
  departement: string | null;
  spelc: string | null;
}

// Maps normalized header names (lowercase, whitespace/newlines collapsed to a single space) to
// the AdherentRecord field they populate. Multiple aliases per field absorb the export's
// inconsistent labelling (e.g. "Nom " with a trailing space in the source workbook). Aliases are
// written unaccented — normalizeHeader() strips diacritics from both sides of the comparison, so
// "Mél."/"Mel." and "Prénom"/"Prenom" resolve to the same alias without listing both.
const HEADER_ALIASES: Record<keyof AdherentRecord, string[]> = {
  // "nom_long" (export adhérents ADEL) : confirmé par l'utilisateur — pas une colonne civilité
  // dédiée comme "Civ.", mais le nom complet préfixé ("M. MARTIN Camille") ; extractCivilite()
  // ci-dessous en isole juste le préfixe, en ignorant le reste (nom/prénom viennent déjà de leurs
  // propres colonnes).
  civilite: ["civ.", "nom_long"],
  nom: ["nom"],
  prenom: ["prenom"],
  // "nom_naissance" : en-tête de l'export "adhérents" ADEL (colonnes à underscores), distinct de
  // l'ancien export "ADEL Etat Jasper" ("nom naissance", avec espace) — les deux formats coexistent.
  nomNaissance: ["nom naissance", "nom_naissance"],
  // "echelle" (export adhérents ADEL) : confirmé par l'utilisateur — porte le grade statutaire
  // ("AGREGE", "CERTIFIE HC", etc.), malgré le nom de colonne qui pourrait laisser penser à autre
  // chose (à ne pas confondre avec le concept d'"échelle" CLASSE_NORMALE/HORS_CLASSE/CLASSE_EXC. du
  // domaine — c'est ADEL qui nomme sa colonne ainsi, pas nous).
  grade: ["grade", "echelle"],
  // "echelon" (export adhérents ADEL) en plus de "ancien echelon" (export Jasper) : les deux
  // désignent le même rôle ici — le dernier échelon connu d'ADEL, utilisé comme repère de repli
  // tant que le rectorat n'a pas fourni de donnée plus fraîche pour cette personne.
  ancienEchelon: ["ancien echelon", "echelon"],
  statut: ["statut"],
  // "contrat" (export adhérents ADEL) en plus de "type de contrat" (export Jasper).
  typeContrat: ["type de contrat", "contrat"],
  // "indice" (export adhérents ADEL) en plus de "ancien indice" (export Jasper) — même rôle de repli
  // que ancienEchelon ci-dessus.
  ancienIndice: ["ancien indice", "indice"],
  // "promo" (export adhérents ADEL) : confirmé par l'utilisateur — porte la date du dernier
  // changement d'échelon, malgré le nom de colonne (qui évoque plutôt une promotion en général).
  dateEffet: ["date_effet", "date effet", "promo"],
  mailPersonnel: ["mel.", "mail perso", "mail personnel", "email"],
  // "departement_rattachem" : en-tête (tronqué) de l'export adhérents ADEL pour ce même champ.
  departement: ["departement", "departement_rattachem"],
  spelc: ["spelc"],
};

function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Splits raw CSV text into rows, respecting double-quoted fields — a quoted field (e.g. a
 * "Commentaire" column with the union's own free-text notes) may itself contain a line break,
 * which must not be treated as a row boundary. A naive `text.split(/\r?\n/)` would cut such a
 * field into several fake rows, and if a fragment happens to land back on the nom/prénom column
 * position, it is read as a bogus extra adherent — that's the row-splitting half of the fix for
 * the "phantom adherent" bug (a stray quote is still possible if a comment itself contains an
 * unescaped `"`, but that's a source-data issue, not one this parser can resolve). */
function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      rows.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** Minimal CSV line splitter supporting double-quoted fields (with "" as an escaped quote) — no
 * external dependency needed for a well-formed spreadsheet export. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Real exports sometimes carry a placeholder date ("00/00/0000") or an out-of-range one (day 31
 * in a 30-day month, day 29 in a non-leap February...) that matches the DD/MM/YYYY digit shape
 * without being a real calendar date. `new Date("YYYY-MM-DD")` is NOT a reliable guard against
 * these — verified it silently rolls an out-of-range day into the following month instead of
 * producing an Invalid Date (e.g. "2023-04-31" parses as if it were May 1st) — so this validates
 * month/day ranges explicitly instead. Matters here because dateEffet is a Prisma DateTime?
 * column: passing it a genuinely Invalid Date (the month=00 placeholder case, which really does
 * fail to parse) throws and crashes the whole import over one bad row — the exact real production
 * crash this was built to fix (GUILLEMIN Maxime, "00/00/0000" in the "promo" column). */
function toIsoDateFromFrench(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year, month, 0).getDate(); // day 0 of `month` = last day of the previous (0-indexed) one, i.e. of `month` itself here
  if (day < 1 || day > daysInMonth) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Real exports sometimes carry a non-numeric value in what's otherwise a numeric column ("NC", a
 * stray annotation, a comma as decimal separator) — `Number()` alone turns any of those into NaN,
 * which crashes the whole import downstream (ancienIndice is a Prisma Int? column; passing it NaN
 * throws rather than being silently stored as invalid data). Falling back to null here treats an
 * unparseable value the same way a blank cell already is, instead of failing the entire file over
 * one bad row. */
function toIntOrNull(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Matches a leading "M"/"Mme"/"Mlle" (with an optional trailing period), whether followed by more
// text ("Mme MARTIN Camille" — the "nom_long" export column) or nothing at all (a dedicated "Civ."
// column, whose whole value already IS just the civilité). The downstream consumer
// (civilitePrefix() in mailing/template.ts) only checks the "mme"/"m" prefix, so no further
// normalization is needed beyond isolating this token from whatever follows it.
const CIVILITE_PREFIX_RE = /^(mme|mlle|m)\.?(?=\s|$)/i;

function extractCivilite(text: string): string | null {
  const m = CIVILITE_PREFIX_RE.exec(text.trim());
  return m ? m[1] : null;
}

export interface AdherentParseResult {
  records: AdherentRecord[];
  /** Field names for which no matching column header was found in the file at all — surfaced once,
   * up front, rather than per-row, since it means every row is missing that field. */
  unmappedFields: (keyof AdherentRecord)[];
}

export function parseAdherentCsv(csvText: string): AdherentParseResult {
  const lines = splitCsvRows(csvText).filter((l) => l.length > 0);
  if (lines.length === 0) return { records: [], unmappedFields: Object.keys(HEADER_ALIASES) as (keyof AdherentRecord)[] };

  const headerCells = parseCsvLine(lines[0]).map(normalizeHeader);
  const columnIndexFor = new Map<keyof AdherentRecord, number>();
  const unmappedFields: (keyof AdherentRecord)[] = [];

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof AdherentRecord, string[]][]) {
    const idx = headerCells.findIndex((h) => aliases.includes(h));
    if (idx === -1) unmappedFields.push(field);
    else columnIndexFor.set(field, idx);
  }

  const records: AdherentRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const get = (field: keyof AdherentRecord): string | null => {
      const idx = columnIndexFor.get(field);
      if (idx === undefined) return null;
      const raw = cells[idx]?.trim();
      return raw ? raw : null;
    };

    const nom = get("nom");
    const prenom = get("prenom");
    if (!nom && !prenom) continue; // blank trailing row

    const ancienIndiceRaw = get("ancienIndice");
    const dateEffetRaw = get("dateEffet");
    const civiliteRaw = get("civilite");

    records.push({
      civilite: civiliteRaw ? extractCivilite(civiliteRaw) : null,
      nom: nom ?? "",
      prenom: prenom ?? "",
      nomNaissance: get("nomNaissance"),
      grade: get("grade"),
      ancienEchelon: get("ancienEchelon"),
      statut: get("statut"),
      typeContrat: get("typeContrat"),
      ancienIndice: ancienIndiceRaw ? toIntOrNull(ancienIndiceRaw) : null,
      dateEffet: dateEffetRaw ? toIsoDateFromFrench(dateEffetRaw) : null,
      mailPersonnel: get("mailPersonnel"),
      departement: get("departement"),
      spelc: get("spelc"),
    });
  }

  return { records, unmappedFields };
}
