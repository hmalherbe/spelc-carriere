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
  mailAcademique: string | null;
  departement: string | null;
  spelc: string | null;
}

// Maps normalized header names (lowercase, whitespace/newlines collapsed to a single space) to
// the AdherentRecord field they populate. Multiple aliases per field absorb the export's
// inconsistent labelling (e.g. "Nom " with a trailing space in the source workbook). Aliases are
// written unaccented — normalizeHeader() strips diacritics from both sides of the comparison, so
// "Mél."/"Mel." and "Prénom"/"Prenom" resolve to the same alias without listing both.
const HEADER_ALIASES: Record<keyof AdherentRecord, string[]> = {
  civilite: ["civ."],
  nom: ["nom"],
  prenom: ["prenom"],
  nomNaissance: ["nom naissance"],
  grade: ["grade"],
  ancienEchelon: ["ancien echelon"],
  statut: ["statut"],
  typeContrat: ["type de contrat"],
  ancienIndice: ["ancien indice"],
  dateEffet: ["date_effet", "date effet"],
  mailPersonnel: ["mel.", "mail perso", "mail personnel"],
  mailAcademique: ["mail academique"],
  departement: ["departement"],
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

function toIsoDateFromFrench(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

export interface AdherentParseResult {
  records: AdherentRecord[];
  /** Field names for which no matching column header was found in the file at all — surfaced once,
   * up front, rather than per-row, since it means every row is missing that field. */
  unmappedFields: (keyof AdherentRecord)[];
}

export function parseAdherentCsv(csvText: string): AdherentParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
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

    records.push({
      civilite: get("civilite"),
      nom: nom ?? "",
      prenom: prenom ?? "",
      nomNaissance: get("nomNaissance"),
      grade: get("grade"),
      ancienEchelon: get("ancienEchelon"),
      statut: get("statut"),
      typeContrat: get("typeContrat"),
      ancienIndice: ancienIndiceRaw ? Number(ancienIndiceRaw) : null,
      dateEffet: dateEffetRaw ? toIsoDateFromFrench(dateEffetRaw) : null,
      mailPersonnel: get("mailPersonnel"),
      mailAcademique: get("mailAcademique"),
      departement: get("departement"),
      spelc: get("spelc"),
    });
  }

  return { records, unmappedFields };
}
