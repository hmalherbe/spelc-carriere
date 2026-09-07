import ExcelJS from "exceljs";
import { parseAdherentCsv, type AdherentParseResult } from "./adherentCsvParser.js";

/**
 * Parses the ADEL export's native format ("export excel suite à une recherche" — an .xlsx
 * workbook, whether downloaded by hand or by the ADEL scraper). Converts the first sheet to CSV
 * text and reuses the already-tested `parseAdherentCsv` — same column-header aliasing, same row
 * parsing, no separate logic to keep in sync.
 */
export async function parseAdherentXlsx(buffer: Buffer): Promise<AdherentParseResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's .d.ts resolves `Buffer` against a different @types/node install than ours, so TS
  // sees a structural mismatch even though this is the exact same runtime Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { records: [], unmappedFields: [] };

  const lines: string[] = [];
  sheet.eachRow((row) => {
    const values = row.values as ExcelJS.CellValue[];
    // row.values is 1-indexed (index 0 is unused) — drop it before mapping to CSV cells.
    const cells = values.slice(1).map((v) => toCsvField(cellToString(v)));
    lines.push(cells.join(","));
  });

  return parseAdherentCsv(lines.join("\n"));
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    return "";
  }
  return String(value);
}

function toCsvField(text: string): string {
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
