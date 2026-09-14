import ExcelJS from "exceljs";

export interface AcademicEmailRecord {
  nom: string;
  prenom: string;
  email: string;
}

export interface AcademicEmailParseResult {
  records: AcademicEmailRecord[];
  unmappedFields: string[];
}

const REQUIRED_HEADERS = ["NOM_USUEL", "PRENOM", "ADRESSE_MAIL"];

/**
 * Parses the académie's own staff-directory export (an .xlsx/.xlsm workbook, one sheet, columns
 * NOM_USUEL / PRENOM / ADRESSE_MAIL / ACADEMIE / UAI_OCCUPATION / TYPE_UAI / GRADE /
 * QUALITE_TYPE_ENG) — used to notify teachers who aren't (yet) Spelc adhérents at their academic
 * email, since we have no personal address for them. Only the three columns needed to build the
 * nom/prénom -> email lookup are read; the rest of the file is ignored.
 */
export async function parseAcademicEmailXlsx(buffer: Buffer): Promise<AcademicEmailParseResult> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { records: [], unmappedFields: REQUIRED_HEADERS };

  const headerRow = sheet.getRow(1);
  const columnIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const header = cellToString(cell.value).trim().toUpperCase();
    if (header) columnIndex.set(header, colNumber);
  });

  const unmappedFields = REQUIRED_HEADERS.filter((h) => !columnIndex.has(h));
  if (unmappedFields.length > 0) return { records: [], unmappedFields };

  const nomCol = columnIndex.get("NOM_USUEL")!;
  const prenomCol = columnIndex.get("PRENOM")!;
  const emailCol = columnIndex.get("ADRESSE_MAIL")!;

  const records: AcademicEmailRecord[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nom = cellToString(row.getCell(nomCol).value).trim();
    const prenom = cellToString(row.getCell(prenomCol).value).trim();
    const email = cellToString(row.getCell(emailCol).value).trim();
    if (!nom || !prenom || !email) return;
    records.push({ nom, prenom, email });
  });

  return { records, unmappedFields: [] };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    return "";
  }
  return String(value);
}
