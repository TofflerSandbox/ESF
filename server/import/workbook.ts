import ExcelJS from 'exceljs';

export type Row = { rowNumber: number; cells: Record<string, string>; raw: Record<string, string>; dates: Record<string, Date | null> };
export type Sheet = { name: string; headers: { raw: string; key: string }[]; rows: Row[] };

/** Header → comparison key: lowercase alphanumerics only ("Pop Start \n(MM/DD/YYYY)" → "popstartmmddyyyy"). */
export const hkey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('result' in v) return v.result == null ? '' : cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
    if ('error' in v) return '';
    return '';
  }
  return String(v);
}

function cellDate(v: ExcelJS.CellValue): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === 'object' && 'result' in v) return cellDate(v.result as ExcelJS.CellValue);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  const s = cellText(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, +m[1] - 1, +m[2])); }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  return null;
}

/** Streaming read. The non-streaming ExcelJS reader expands sheet-wide data-validation ranges
 *  cell by cell and hangs on these workbooks, so we stream and only keep the sheets we need. */
export async function loadWorkbook(path: string, sheetNames: string[]): Promise<Record<string, Sheet>> {
  const wanted = new Set(sheetNames);
  const out: Record<string, Sheet> = {};
  const seen: string[] = [];
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit', entries: 'emit',
  });
  for await (const ws of reader as unknown as AsyncIterable<ExcelJS.Worksheet & AsyncIterable<ExcelJS.Row>>) {
    const name = ws.name;
    seen.push(name);
    if (!wanted.has(name)) { for await (const _ of ws) { /* drain */ } continue; }
    const headers: { raw: string; key: string; col: number }[] = [];
    const rows: Row[] = [];
    for await (const row of ws) {
      if (row.number === 1) {
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          const raw = cellText(cell.value).replace(/\s+/g, ' ').trim();
          if (raw) headers.push({ raw, key: hkey(raw), col });
        });
        continue;
      }
      const cells: Record<string, string> = {}, raw: Record<string, string> = {}, dates: Record<string, Date | null> = {};
      let any = false;
      for (const h of headers) {
        const v = row.getCell(h.col).value;
        const t = cellText(v).trim();
        if (t) any = true;
        cells[h.key] = t;            // last header with the same key wins (rare)
        if (t) raw[h.raw] = t;
        dates[h.key] = cellDate(v);
      }
      if (any) rows.push({ rowNumber: row.number, cells, raw, dates });
    }
    out[name] = { name, headers: headers.map(({ raw, key }) => ({ raw, key })), rows };
  }
  const missing = sheetNames.filter(n => !out[n]);
  if (missing.length) throw new Error(`Sheet(s) not found: ${missing.join(', ')}. Available: ${seen.join(', ')}`);
  return out;
}
