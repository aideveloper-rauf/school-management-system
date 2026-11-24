/**
 * Minimal RFC 4180 CSV parser (no dependency). Handles quoted fields, escaped quotes (""), CRLF/LF,
 * a UTF-8 BOM, and Excel's habit of a trailing empty line. Delimiter is auto-detected between
 * comma and semicolon from the header line (some locales export with ';').
 */
export interface ParsedCsv {
  headers: string[];
  /** Data rows (header excluded). Blank lines are skipped. */
  rows: string[][];
}

export class CsvError extends Error {}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && record[0]!.trim() === '')) records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      endField();
      i++;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRecord();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new CsvError('Unclosed quote');
  if (field !== '' || record.length > 0) endRecord();

  if (records.length === 0) throw new CsvError('The file is empty');
  const headers = records[0]!.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  );
  return { headers, rows: records.slice(1) };
}

/** Rows as objects keyed by normalised header. Missing trailing cells become ''. Values are trimmed. */
export function csvObjects(parsed: ParsedCsv): Record<string, string>[] {
  return parsed.rows.map((r) => Object.fromEntries(parsed.headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}
