import type {
  CellInferredType,
  ClusterGroup,
  ClusterMethod,
  ColumnDataType,
  ColumnDiagnostic,
  ColumnQualityProfile,
  DataRow,
  DateTargetFormat,
  DeletedRowEntry,
  DuplicateSummary,
  FacetItem,
  FileIngestionMeta,
  IndexedRow,
  NumericHistogramBin,
  NumericRangeProfile,
  QualityFilterKind,
  RefineStep,
  TimelineBucket,
  TypeDistributionItem,
} from "../types/refine";
import { compileFormula, evaluateFormulaAst } from "./formula/evaluator";

function detectDelimiter(sampleLine: string): { char: string; label: string } {
  const candidates: Array<{ char: string; label: string }> = [
    { char: ",", label: "Coma (,)" },
    { char: ";", label: "Punto y coma (;)" },
    { char: "\t", label: "Tabulador (TSV)" },
    { char: "|", label: "Pipe (|)" },
  ];
  let best = candidates[0];
  let bestCount = -1;
  for (const c of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sampleLine.length; i++) {
      const ch = sampleLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === c.char) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function parseCsvText(raw: string): {
  columns: string[];
  rows: DataRow[];
  meta: FileIngestionMeta;
} {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i++;
      if (current.length > 0) lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);

  if (lines.length === 0) {
    return {
      columns: [],
      rows: [],
      meta: { delimiterLabel: "Coma (,)", dedupedHeaders: 0 },
    };
  }

  const delimiter = detectDelimiter(lines[0]);

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === delimiter.char && !quoted) {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    return cells;
  };

  const rawHeaders = splitRow(lines[0]).map((c, idx) => c.trim() || `Columna_${idx + 1}`);
  const headerCounts = new Map<string, number>();
  let dedupedHeaders = 0;
  const columns = rawHeaders.map((h) => {
    const seen = headerCounts.get(h) ?? 0;
    headerCounts.set(h, seen + 1);
    if (seen === 0) return h;
    dedupedHeaders++;
    return `${h}_${seen + 1}`;
  });

  const rows: DataRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const vals = splitRow(lines[r]);
    const row: DataRow = {};
    columns.forEach((col, idx) => {
      row[col] = vals[idx] ?? "";
    });
    rows.push(row);
  }

  return {
    columns,
    rows,
    meta: { delimiterLabel: delimiter.label, dedupedHeaders },
  };
}

export function serializeCsv(columns: string[], rows: DataRow[]): string {
  const escapeCell = (val: string): string => {
    if (/[",\n\r]/.test(val)) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const header = columns.map(escapeCell).join(",");
  const body = rows.map((row) => columns.map((col) => escapeCell(row[col] ?? "")).join(","));
  return [header, ...body].join("\n");
}

function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const MONTHS_ES_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_ES_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MONTH_NAME_MAP: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

function isValidCalendarYMD(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2150 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day
  );
}

function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeAndClampYMD(
  year: number,
  rawFirst: number,
  rawSecond: number,
  firstIsMonthPreference = false
): { year: number; month: number; day: number; wasRepaired: boolean } | null {
  if (year < 1900 || year > 2150) return null;

  let month = firstIsMonthPreference ? rawFirst : rawSecond;
  let day = firstIsMonthPreference ? rawSecond : rawFirst;
  let wasRepaired = false;

  if (month > 12 && day >= 1 && day <= 12) {
    const tmp = month;
    month = day;
    day = tmp;
    wasRepaired = true;
  }

  if (month < 1) {
    month = 1;
    wasRepaired = true;
  } else if (month > 12) {
    month = 12;
    wasRepaired = true;
  }

  const maxDay = daysInMonthUTC(year, month);
  if (day < 1) {
    day = 1;
    wasRepaired = true;
  } else if (day > maxDay) {
    day = maxDay;
    wasRepaired = true;
  }

  return { year, month, day, wasRepaired };
}

export function parseCalendarDate(
  raw: string,
  allowRepair = true
): { year: number; month: number; day: number; wasRepaired: boolean } | null {
  const cleaned = raw
    .trim()
    .replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i, "")
    .trim();
  if (!cleaned) return null;

  if (/^\d{5}(\.\d+)?$/.test(cleaned)) {
    const serial = Math.floor(Number(cleaned));
    if (serial >= 20000 && serial <= 70000) {
      const utcMs = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(utcMs);
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        wasRepaired: false,
      };
    }
  }

  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(cleaned);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (isValidCalendarYMD(y, m, d)) {
      return { year: y, month: m, day: d, wasRepaired: false };
    }
    return allowRepair ? normalizeAndClampYMD(y, m, d, true) : null;
  }

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(cleaned);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (isValidCalendarYMD(y, second, first)) {
      return { year: y, month: second, day: first, wasRepaired: false };
    }
    return allowRepair ? normalizeAndClampYMD(y, first, second, false) : null;
  }

  const textMatch = /^(\d{1,2})[\s/-]+(?:de\s+)?([a-záéíóú]+)[\s,/-]+(?:de[l]?\s+)?(\d{2,4})$/i.exec(
    stripDiacritics(cleaned.toLowerCase())
  );
  if (textMatch) {
    const d = Number(textMatch[1]);
    const m = MONTH_NAME_MAP[textMatch[2]];
    let y = Number(textMatch[3]);
    if (y < 100) y += 2000;
    if (m) {
      if (isValidCalendarYMD(y, m, d)) {
        return { year: y, month: m, day: d, wasRepaired: false };
      }
      return allowRepair ? normalizeAndClampYMD(y, m, d, true) : null;
    }
  }

  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function standardizeDateValue(raw: string, format: DateTargetFormat): string {
  const parsed = parseCalendarDate(raw, true);
  if (!parsed) return raw;
  const y = String(parsed.year);
  const m = pad2(parsed.month);
  const d = pad2(parsed.day);

  switch (format) {
    case "iso":
      return `${y}-${m}-${d}`;
    case "ymd_slash":
      return `${y}/${m}/${d}`;
    case "dmy_slash":
      return `${d}/${m}/${y}`;
    case "dmy_dash":
      return `${d}-${m}-${y}`;
    case "mdy_slash":
      return `${m}/${d}/${y}`;
    case "spanish_short":
      return `${d}-${MONTHS_ES_SHORT[parsed.month - 1]}-${y}`;
    case "spanish_long":
      return `${parsed.day} de ${MONTHS_ES_LONG[parsed.month - 1]} de ${y}`;
  }
}

export function isLikelyDateColumn(columnName: string, rows: DataRow[]): boolean {
  if (/fecha|date|alta|creacion|registro|nacimiento|vencimiento/i.test(columnName)) return true;
  let nonEmpty = 0;
  let dateHits = 0;
  for (const r of rows.slice(0, 40)) {
    const v = (r[columnName] ?? "").trim();
    if (!v) continue;
    nonEmpty++;
    if (parseCalendarDate(v, true) !== null) dateHits++;
  }
  return nonEmpty > 0 && dateHits / nonEmpty >= 0.5;
}

function isLikelyNumericColumn(rows: DataRow[], columnName: string): boolean {
  let nonEmpty = 0;
  let numHits = 0;
  for (const r of rows.slice(0, 40)) {
    const v = (r[columnName] ?? "").trim();
    if (!v) continue;
    nonEmpty++;
    if (/^\$?\s*-?[\d,]+(\.\d+)?$/.test(v)) numHits++;
  }
  return nonEmpty > 0 && numHits / nonEmpty >= 0.7;
}

export const ERROR_CELL_MARKER = "#ERROR!";

export function isErrorCellValue(val: string): boolean {
  const t = val.trim();
  if (!t) return false;
  return /^(#ERROR!|#N\/A|#VALUE!|#REF!|#DIV\/0!|#NAME\?|#NUM!|#NULL!|Error\()/i.test(t);
}

export function hasControlOrInvisibleChars(val: string): boolean {
  return /[\u0000-\u001F\u007F\u00A0\u200B-\u200D\uFEFF]/.test(val);
}

export function deepCleanText(val: string): string {
  return val
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n\t\u00A0]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseNumericValue(raw: string): number | null {
  const t = raw.trim();
  if (!t || isErrorCellValue(t)) return null;
  if (!/^\$?\s*-?[\d,]+(\.\d+)?%?$/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const cleaned = t.replace(/[$,%\s]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBooleanValue(raw: string): boolean | null {
  const norm = stripDiacritics(raw.trim().toLowerCase());
  if (["true", "verdadero", "si", "1", "yes", "v", "activo"].includes(norm)) return true;
  if (["false", "falso", "no", "0", "f", "inactivo"].includes(norm)) return false;
  return null;
}

export function inferCellType(raw: string, columnHintIsDate = false): CellInferredType {
  const t = raw.trim();
  if (!t) return "empty";
  if (isErrorCellValue(t)) return "error";
  if (parseBooleanValue(t) !== null && !/^\d+$/.test(t)) return "boolean";
  if (parseNumericValue(t) !== null && !(columnHintIsDate && /^\d{5}$/.test(t))) {
    return "number";
  }
  if (parseCalendarDate(t, false) !== null || (columnHintIsDate && parseCalendarDate(t, true) !== null)) {
    return "date";
  }
  return "text";
}

function isSuspiciousDate(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(trimmed)) {
    const strict = parseCalendarDate(trimmed, false);
    return strict === null;
  }
  return /sin\s+fecha|fecha\s+invalida|^\d{5}$/i.test(trimmed);
}

export function classifyCellQuality(
  val: string,
  opts: { isDateCol: boolean; isPostalCol: boolean; dominantType: CellInferredType }
): QualityFilterKind {
  if (val.trim() === "") return "empty";
  if (isErrorCellValue(val)) return "suspect";
  if (hasControlOrInvisibleChars(val)) return "suspect";
  if (opts.isDateCol && isSuspiciousDate(val)) return "suspect";
  if (opts.isPostalCol && /^\d{3,4}$/.test(val.trim())) return "suspect";
  if (opts.dominantType === "number" && inferCellType(val, false) === "text") return "suspect";
  if (opts.dominantType === "date" && inferCellType(val, true) === "text") return "suspect";
  return "valid";
}

export function computeColumnDiagnostic(rows: DataRow[], column: string): ColumnDiagnostic {
  const seen = new Set<string>();
  let emptyCount = 0;
  let whitespaceIssueCount = 0;
  let suspiciousDateCount = 0;
  let shortPostalCodeCount = 0;
  let errorCount = 0;
  let controlCharCount = 0;
  const isPostalCol = /cp|postal/i.test(column);

  for (const row of rows) {
    const val = row[column] ?? "";
    if (val.trim() === "") {
      emptyCount++;
    } else {
      seen.add(val);
      if (isErrorCellValue(val)) {
        errorCount++;
      }
      if (hasControlOrInvisibleChars(val)) {
        controlCharCount++;
      }
      if (val !== val.trim() || /\s{2,}/.test(val)) {
        whitespaceIssueCount++;
      }
      if (isSuspiciousDate(val)) {
        suspiciousDateCount++;
      }
      if (isPostalCol && /^\d{3,4}$/.test(val.trim())) {
        shortPostalCodeCount++;
      }
    }
  }

  return {
    column,
    uniqueCount: seen.size,
    emptyCount,
    whitespaceIssueCount,
    suspiciousDateCount,
    shortPostalCodeCount,
    errorCount,
    controlCharCount,
  };
}

const TYPE_LABELS: Record<CellInferredType, string> = {
  number: "Número",
  date: "Fecha",
  boolean: "Booleano",
  text: "Texto",
  empty: "Vacío",
  error: "Error",
};

export function computeColumnQualityProfile(
  rows: DataRow[],
  column: string
): ColumnQualityProfile {
  const totalRows = rows.length;
  const isDateCol = isLikelyDateColumn(column, rows);
  const isPostalCol = /cp|postal/i.test(column);

  const typeCounts: Record<CellInferredType, number> = {
    number: 0,
    date: 0,
    boolean: 0,
    text: 0,
    empty: 0,
    error: 0,
  };

  for (const row of rows) {
    const t = inferCellType(row[column] ?? "", isDateCol);
    typeCounts[t]++;
  }

  let dominantType: CellInferredType = "text";
  let bestCount = -1;
  for (const candidate of ["number", "date", "boolean", "text"] as CellInferredType[]) {
    if (typeCounts[candidate] > bestCount) {
      bestCount = typeCounts[candidate];
      dominantType = candidate;
    }
  }
  const nonEmptyCount = totalRows - typeCounts.empty;
  if (nonEmptyCount > 0 && typeCounts[dominantType] / nonEmptyCount < 0.6) {
    dominantType = "text";
  }

  let validCount = 0;
  let emptyCount = 0;
  let suspectCount = 0;

  for (const row of rows) {
    const q = classifyCellQuality(row[column] ?? "", {
      isDateCol,
      isPostalCol,
      dominantType,
    });
    if (q === "valid") validCount++;
    else if (q === "empty") emptyCount++;
    else suspectCount++;
  }

  const pct = (n: number) => (totalRows > 0 ? Math.round((n / totalRows) * 100) : 0);

  const typeDistribution: TypeDistributionItem[] = (
    Object.keys(typeCounts) as CellInferredType[]
  )
    .filter((t) => typeCounts[t] > 0)
    .map((t) => ({
      type: t,
      label: TYPE_LABELS[t],
      count: typeCounts[t],
      percent: pct(typeCounts[t]),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    column,
    totalRows,
    validCount,
    emptyCount,
    suspectCount,
    validPercent: pct(validCount),
    emptyPercent: pct(emptyCount),
    suspectPercent: pct(suspectCount),
    dominantType,
    typeDistribution,
  };
}

export function buildColumnFrequencyMap(rows: DataRow[], column: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = row[column] ?? "";
    if (val.trim() === "") continue;
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  return counts;
}

export function serializeRowSignature(row: DataRow, columns: string[]): string {
  return columns.map((c) => row[c] ?? "").join("\u001F");
}

export function computeDuplicateSummary(
  rows: DataRow[],
  column: string,
  columns: string[]
): DuplicateSummary {
  const colCounts = buildColumnFrequencyMap(rows, column);
  const repeatedItems: Array<{ value: string; count: number }> = [];
  let duplicateColumnRows = 0;

  for (const [value, count] of colCounts.entries()) {
    if (count > 1) {
      repeatedItems.push({ value, count });
      duplicateColumnRows += count - 1;
    }
  }
  repeatedItems.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "es"));

  const rowSeen = new Set<string>();
  let exactRowDuplicates = 0;
  for (const row of rows) {
    const sig = serializeRowSignature(row, columns);
    if (rowSeen.has(sig)) exactRowDuplicates++;
    else rowSeen.add(sig);
  }

  return {
    column,
    totalRows: rows.length,
    uniqueNonEmptyValues: colCounts.size,
    repeatedValueGroups: repeatedItems.length,
    duplicateColumnRows,
    exactRowDuplicates,
    repeatedItems,
  };
}

export function computeNumericRangeProfile(
  rows: DataRow[],
  column: string,
  binCount = 8
): NumericRangeProfile | null {
  const nums: number[] = [];
  for (const row of rows) {
    const n = parseNumericValue(row[column] ?? "");
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) {
    return {
      min,
      max,
      numericCount: nums.length,
      bins: [{ index: 0, min, max, label: `${min}`, count: nums.length }],
    };
  }

  const step = (max - min) / binCount;
  const bins: NumericHistogramBin[] = Array.from({ length: binCount }, (_, idx) => {
    const bMin = min + idx * step;
    const bMax = idx === binCount - 1 ? max : min + (idx + 1) * step;
    const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
    return {
      index: idx,
      min: bMin,
      max: bMax,
      label: `${fmt(bMin)}–${fmt(bMax)}`,
      count: 0,
    };
  });

  for (const n of nums) {
    const rawIdx = Math.floor((n - min) / step);
    const idx = Math.min(binCount - 1, Math.max(0, rawIdx));
    bins[idx].count++;
  }

  return { min, max, numericCount: nums.length, bins };
}

export function computeDateTimeline(rows: DataRow[], column: string): TimelineBucket[] {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const raw = row[column] ?? "";
    if (!raw.trim()) continue;
    const parsed = parseCalendarDate(raw, true);
    if (!parsed) {
      buckets.set("Inválida / Sin fecha", (buckets.get("Inválida / Sin fecha") ?? 0) + 1);
      continue;
    }
    const period = `${parsed.year}-${pad2(parsed.month)}`;
    buckets.set(period, (buckets.get(period) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function applyReplaceValue(
  val: string,
  opts: {
    find: string;
    replace: string;
    matchMode: "exact" | "contains" | "regex";
    caseSensitive?: boolean;
  }
): string {
  if (opts.matchMode === "exact") {
    if (opts.caseSensitive) return val === opts.find ? opts.replace : val;
    return val.toLowerCase() === opts.find.toLowerCase() ? opts.replace : val;
  }
  if (opts.matchMode === "contains") {
    if (!opts.find) return val;
    if (opts.caseSensitive) return val.split(opts.find).join(opts.replace);
    const escaped = opts.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return val.replace(new RegExp(escaped, "gi"), opts.replace);
  }
  try {
    if (!opts.find) return val;
    const flags = opts.caseSensitive ? "g" : "gi";
    return val.replace(new RegExp(opts.find, flags), opts.replace);
  } catch {
    return val;
  }
}

export function applyExtractText(
  val: string,
  opts: {
    mode: "before" | "after" | "between" | "first_n" | "last_n";
    delimiter?: string;
    endDelimiter?: string;
    count?: number;
  }
): string {
  const delim = opts.delimiter ?? "";
  const n = Math.max(0, Math.floor(opts.count ?? 0));
  switch (opts.mode) {
    case "before": {
      if (!delim) return val;
      const idx = val.indexOf(delim);
      return idx === -1 ? val : val.slice(0, idx);
    }
    case "after": {
      if (!delim) return val;
      const idx = val.indexOf(delim);
      return idx === -1 ? "" : val.slice(idx + delim.length);
    }
    case "between": {
      const endDelim = opts.endDelimiter ?? delim;
      if (!delim || !endDelim) return "";
      const start = val.indexOf(delim);
      if (start === -1) return "";
      const from = start + delim.length;
      const end = val.indexOf(endDelim, from);
      return end === -1 ? "" : val.slice(from, end);
    }
    case "first_n":
      return val.slice(0, n);
    case "last_n":
      return n === 0 ? "" : val.slice(-n);
  }
}

export function splitFlexibleParts(
  val: string,
  opts: { mode: "delimiter" | "length"; delimiter?: string; maxParts?: number; length?: number }
): string[] {
  if (opts.mode === "length") {
    const chunkLen = Math.max(1, Math.floor(opts.length ?? 2));
    const parts: string[] = [];
    for (let i = 0; i < val.length; i += chunkLen) {
      parts.push(val.slice(i, i + chunkLen));
    }
    return parts.length > 0 ? parts : [""];
  }
  const sep = opts.delimiter ?? ",";
  if (!sep) return [val];
  const rawParts = val.split(sep);
  const limit = Math.max(2, Math.floor(opts.maxParts ?? rawParts.length));
  if (rawParts.length <= limit) return rawParts.map((p) => p.trim());
  const head = rawParts.slice(0, limit - 1).map((p) => p.trim());
  const tail = rawParts.slice(limit - 1).join(sep).trim();
  return [...head, tail];
}

export function applyCastColumnValue(
  raw: string,
  targetType: ColumnDataType,
  onError: "mark" | "null" | "keep"
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isErrorCellValue(trimmed)) {
    if (onError === "null") return "";
    if (onError === "keep") return raw;
    return ERROR_CELL_MARKER;
  }

  switch (targetType) {
    case "text":
      return raw;
    case "integer": {
      const n = parseNumericValue(trimmed);
      if (n !== null) return String(Math.round(n));
      return onError === "null" ? "" : onError === "keep" ? raw : ERROR_CELL_MARKER;
    }
    case "decimal": {
      const n = parseNumericValue(trimmed);
      if (n !== null) return String(n);
      return onError === "null" ? "" : onError === "keep" ? raw : ERROR_CELL_MARKER;
    }
    case "date": {
      const parsed = parseCalendarDate(trimmed, false);
      if (parsed) return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
      return onError === "null" ? "" : onError === "keep" ? raw : ERROR_CELL_MARKER;
    }
    case "boolean": {
      const b = parseBooleanValue(trimmed);
      if (b !== null) return b ? "TRUE" : "FALSE";
      return onError === "null" ? "" : onError === "keep" ? raw : ERROR_CELL_MARKER;
    }
  }
}

export function computeFacets(rows: DataRow[], column: string): FacetItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = row[column] ?? "";
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      isEmpty: value.trim() === "",
    }))
    .sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? -1 : 1;
      return b.count - a.count || a.value.localeCompare(b.value, "es");
    });
}

// 1. Fingerprint
function fingerprintKey(val: string): string {
  const tokens = stripDiacritics(val.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return Array.from(new Set(tokens)).join(" ");
}

// 2. N-gram Fingerprint
function ngramFingerprintKey(val: string, n = 2): string {
  const clean = stripDiacritics(val.toLowerCase()).replace(/[^a-z0-9]/g, "");
  if (clean.length <= n) return clean;
  const grams = new Set<string>();
  for (let i = 0; i <= clean.length - n; i++) {
    grams.add(clean.slice(i, i + n));
  }
  return Array.from(grams).sort().join("");
}

// 3. Levenshtein
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

// 4. Fonético en Español
export function spanishPhoneticKey(val: string): string {
  let s = stripDiacritics(val.toLowerCase()).replace(/[^a-z\s]/g, " ");
  s = s
    .replace(/\bh/g, "")
    .replace(/h/g, "")
    .replace(/ll/g, "y")
    .replace(/v/g, "b")
    .replace(/z/g, "s")
    .replace(/c([ei])/g, "s$1")
    .replace(/qu([ei])/g, "k$1")
    .replace(/c([aou])/g, "k$1")
    .replace(/g([ei])/g, "j$1")
    .replace(/x/g, "j")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/\s+/g, "");
  return s;
}

// 5. Subsecuencia Consonántica / Abreviaturas
function isConsonantAbbrev(shortStr: string, longStr: string): boolean {
  const s = stripDiacritics(shortStr.toLowerCase()).replace(/[^a-z]/g, "");
  const l = stripDiacritics(longStr.toLowerCase()).replace(/[^a-z]/g, "");
  if (s.length < 2 || s.length >= l.length - 1 || s[0] !== l[0]) return false;
  if (s.length === 2 && !shortStr.includes(".")) return false;
  let j = 0;
  for (let i = 0; i < l.length && j < s.length; i++) {
    if (l[i] === s[j]) j++;
  }
  return j === s.length;
}

const KNOWN_ALIASES: Record<string, string> = {
  cdmx: "CDMX",
  "cd de mexico": "CDMX",
  "ciudad de mexico": "CDMX",
  "villahermosa tab": "Villahermosa",
  "ver xalapa": "Xalapa",
  "q roo": "Quintana Roo",
  "quintana roo": "Quintana Roo",
  "n l": "Nuevo León",
  "nuevo leon": "Nuevo León",
};

export function computeClusters(rows: DataRow[], column: string): ClusterGroup[] {
  if (isLikelyDateColumn(column, rows) || isLikelyNumericColumn(rows, column)) {
    return [];
  }

  const facets = computeFacets(rows, column).filter((f) => !f.isEmpty);
  if (facets.length < 2) return [];

  const n = facets.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const methodForPair = new Map<number, ClusterMethod>();

  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number, method: ClusterMethod) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
      if (!methodForPair.has(ra)) methodForPair.set(ra, method);
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = facets[i].value;
      const b = facets[j].value;
      const fpA = fingerprintKey(a);
      const fpB = fingerprintKey(b);

      if (fpA === fpB || (KNOWN_ALIASES[fpA] && KNOWN_ALIASES[fpA] === KNOWN_ALIASES[fpB])) {
        union(i, j, "Fingerprint");
        continue;
      }

      if (/\d/.test(a) || /\d/.test(b)) continue;

      const ngA = ngramFingerprintKey(a, 2);
      const ngB = ngramFingerprintKey(b, 2);
      if (ngA.length >= 5 && ngA === ngB) {
        union(i, j, "N-gram");
        continue;
      }

      const phA = spanishPhoneticKey(a);
      const phB = spanishPhoneticKey(b);
      if (phA.length >= 4 && phA === phB) {
        union(i, j, "Fonético ES");
        continue;
      }

      const normA = stripDiacritics(a.toLowerCase()).replace(/[^a-z]/g, "");
      const normB = stripDiacritics(b.toLowerCase()).replace(/[^a-z]/g, "");
      if (normA.length >= 4 && normB.length >= 4 && levenshtein(normA, normB) <= 2) {
        union(i, j, "Levenshtein");
        continue;
      }

      if (isConsonantAbbrev(a, b) || isConsonantAbbrev(b, a)) {
        union(i, j, "Abreviatura");
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const result: ClusterGroup[] = [];
  for (const [root, indices] of groups.entries()) {
    if (indices.length < 2) continue;
    const variants = indices.map((idx) => ({
      value: facets[idx].value,
      count: facets[idx].count,
    }));
    const sortedForCanonical = [...variants].sort((a, b) => {
      const aClean = a.value === a.value.trim() && !/[.]/.test(a.value) ? 1 : 0;
      const bClean = b.value === b.value.trim() && !/[.]/.test(b.value) ? 1 : 0;
      if (aClean !== bClean) return bClean - aClean;
      return b.count - a.count;
    });
    result.push({
      id: `cluster_${column}_${root}`,
      method: methodForPair.get(root) ?? "Fingerprint",
      suggestedCanonical: sortedForCanonical[0].value.trim(),
      variants,
    });
  }

  return result;
}

export function toTitleCase(input: string): string {
  return input.toLowerCase().replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

export function extractCleanNumber(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return "";
  if (/^\$?\s*-?[\d,]+(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(/[^0-9.-]/g, "");
  }
  return trimmed.replace(/\D+/g, "");
}

export function padMexicanPostalCode(val: string): string {
  const digits = val.replace(/\D+/g, "");
  if (!digits) return val;
  return digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
}

// ============================================================================
// Separador Inteligente de Nombres Latinoamericanos (3 Columnas Clásicas)
// Nombre(s) | Apellido_Paterno | Apellido_Materno
// ============================================================================
const NAME_CONNECTORS = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "san",
  "santa",
  "y",
  "vda",
  "vda.",
  "viuda",
  "mc",
  "mac",
]);

const COMMON_SECOND_GIVEN_NAMES = new Set([
  "carlos",
  "luis",
  "miguel",
  "angel",
  "fernanda",
  "fernando",
  "alberto",
  "antonio",
  "manuel",
  "jose",
  "maria",
  "guadalupe",
  "sofia",
  "elena",
  "isabel",
  "alejandro",
  "alejandra",
  "eduardo",
  "enrique",
  "francisco",
  "javier",
  "daniel",
  "daniela",
  "pablo",
  "paola",
  "andrea",
  "gabriela",
  "carmen",
  "rosa",
  "luz",
  "jesus",
  "arturo",
  "armando",
  "cesar",
  "david",
  "emilio",
  "esteban",
  "fabiola",
  "gerardo",
  "hector",
  "hugo",
  "ignacio",
  "ivan",
  "jorge",
  "julio",
  "laura",
  "leticia",
  "liliana",
  "lorena",
  "lucia",
  "martha",
  "martin",
  "mauricio",
  "monica",
  "natalia",
  "norma",
  "oscar",
  "patricia",
  "paul",
  "pedro",
  "rafael",
  "omar",
  "ramon",
  "raul",
  "ricardo",
  "roberto",
  "rocio",
  "rodolfo",
  "rodrigo",
  "ruben",
  "salvador",
  "sandra",
  "santiago",
  "sergio",
  "silvia",
  "teresa",
  "veronica",
  "victor",
  "victoria",
  "ximena",
  "yolanda",
]);

export function splitLatinAmericanName(raw: string): {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
} {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { nombres: "", apellidoPaterno: "", apellidoMaterno: "" };
  }

  // Etapa 1: Agrupar conectores (de, del, de la, de los, san, santa) con la palabra siguiente
  const blocks: string[] = [];
  let prefixBuffer: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const norm = stripDiacritics(w.toLowerCase());
    if (NAME_CONNECTORS.has(norm) && i < words.length - 1) {
      prefixBuffer.push(w);
    } else {
      if (prefixBuffer.length > 0) {
        const combined = [...prefixBuffer, w].join(" ");
        prefixBuffer = [];
        // Si es "del Carmen", "de Jesús", "de la Luz", "del Rosario" después de María/José en el primer bloque, unir al nombre
        const normCombined = stripDiacritics(combined.toLowerCase());
        if (
          blocks.length === 1 &&
          /^(del?\s+(carmen|jesus|socorro|rosario|luz|pilar|rocio|refugio|consuelo)|de\s+la\s+(luz|cruz|paz))$/.test(
            normCombined
          ) &&
          /^(maria|ma\.?|jose|j\.?)$/.test(stripDiacritics(blocks[0].toLowerCase()))
        ) {
          blocks[0] = `${blocks[0]} ${combined}`;
        } else {
          blocks.push(combined);
        }
      } else {
        blocks.push(w);
      }
    }
  }
  if (prefixBuffer.length > 0) {
    blocks.push(prefixBuffer.join(" "));
  }

  // Etapa 2: Repartir bloques en Nombre(s), Apellido_Paterno y Apellido_Materno
  if (blocks.length === 1) {
    return { nombres: blocks[0], apellidoPaterno: "", apellidoMaterno: "" };
  }

  if (blocks.length === 2) {
    return { nombres: blocks[0], apellidoPaterno: blocks[1], apellidoMaterno: "" };
  }

  if (blocks.length === 3) {
    const secondNorm = stripDiacritics(blocks[1].toLowerCase());
    const firstAlreadyCompound = blocks[0].includes(" ");
    if (!firstAlreadyCompound && COMMON_SECOND_GIVEN_NAMES.has(secondNorm)) {
      // Ej. "Juan Carlos Méndez", "María Fernanda Ruiz", "Luis Ángel Torres" -> 2 Nombres + 1 Apellido
      return {
        nombres: `${blocks[0]} ${blocks[1]}`,
        apellidoPaterno: blocks[2],
        apellidoMaterno: "",
      };
    }
    // Ej. "Ana López Pérez" -> 1 Nombre + 2 Apellidos
    return {
      nombres: blocks[0],
      apellidoPaterno: blocks[1],
      apellidoMaterno: blocks[2],
    };
  }

  // 4 o más bloques: últimos 2 bloques son Apellido_Paterno y Apellido_Materno
  return {
    nombres: blocks.slice(0, blocks.length - 2).join(" "),
    apellidoPaterno: blocks[blocks.length - 2],
    apellidoMaterno: blocks[blocks.length - 1],
  };
}

function uniqueColName(existing: string[], desired: string): string {
  if (!existing.includes(desired)) return desired;
  let k = 2;
  while (existing.includes(`${desired}_${k}`)) k++;
  return `${desired}_${k}`;
}

export function replayRecipeWithTrash(
  baseRows: DataRow[],
  steps: RefineStep[],
  baseColumns?: string[]
): {
  columns: string[];
  hiddenColumns: string[];
  activeRows: IndexedRow[];
  trash: DeletedRowEntry[];
} {
  let columns: string[] =
    baseColumns && baseColumns.length > 0
      ? [...baseColumns]
      : baseRows.length > 0
        ? Object.keys(baseRows[0])
        : [];
  let hiddenColumns: string[] = [];
  let activeRows: IndexedRow[] = baseRows.map((data, origIdx) => ({ origIdx, data: { ...data } }));
  let trash: DeletedRowEntry[] = [];

  for (const step of steps) {
    if (!step.enabled) continue;
    const { column, kind, params } = step;

    if (kind === "hide_column") {
      if (columns.length > 1 && columns.includes(column)) {
        columns = columns.filter((c) => c !== column);
        if (!hiddenColumns.includes(column)) hiddenColumns.push(column);
      }
      continue;
    }

    if (kind === "restore_column") {
      if (hiddenColumns.includes(column) && !columns.includes(column)) {
        hiddenColumns = hiddenColumns.filter((c) => c !== column);
        columns = [...columns, column];
      }
      continue;
    }

    if (kind === "duplicate_column") {
      const colIdx = columns.indexOf(column);
      if (colIdx === -1) continue;
      const desired = String(params?.newColumnName ?? `${column}_Copia`).trim() || `${column}_Copia`;
      const targetCol = uniqueColName(columns, desired);
      columns = [...columns.slice(0, colIdx + 1), targetCol, ...columns.slice(colIdx + 1)];
      activeRows = activeRows.map((item) => ({
        ...item,
        data: { ...item.data, [targetCol]: item.data[column] ?? "" },
      }));
      continue;
    }

    if (kind === "rename_column") {
      const colIdx = columns.indexOf(column);
      if (colIdx === -1) continue;
      const desired = String(params?.newColumnName ?? "").trim();
      if (!desired || desired === column) continue;
      const targetCol = uniqueColName(columns, desired);
      columns = columns.map((c, idx) => (idx === colIdx ? targetCol : c));
      activeRows = activeRows.map((item) => {
        const nextData: DataRow = {};
        for (const [k, v] of Object.entries(item.data)) {
          nextData[k === column ? targetCol : k] = v;
        }
        return { ...item, data: nextData };
      });
      continue;
    }

    if (kind === "split_into_two_columns") {
      const colIdx = columns.indexOf(column);
      if (colIdx === -1) continue;
      const sep = String(params?.separator ?? "-");
      const defaultLeft = column.includes("_") ? column.split("_")[0] : `${column}_1`;
      const defaultRight = column.includes("_")
        ? column.split("_").slice(1).join("_")
        : `${column}_2`;
      const leftCol = uniqueColName(columns, String(params?.leftCol ?? defaultLeft));
      const rightCol = uniqueColName([...columns, leftCol], String(params?.rightCol ?? defaultRight));

      columns = [
        ...columns.slice(0, colIdx + 1),
        leftCol,
        rightCol,
        ...columns.slice(colIdx + 1),
      ];
      activeRows = activeRows.map((item) => {
        const val = item.data[column] ?? "";
        const parts = val.split(sep);
        const leftVal = (parts[0] ?? "").trim();
        const rightVal = (parts.length > 1 ? parts.slice(1).join(sep) : "").trim();
        return {
          ...item,
          data: {
            ...item.data,
            [leftCol]: leftVal,
            [rightCol]: rightVal,
          },
        };
      });
      continue;
    }

    if (kind === "split_mexican_name") {
      const colIdx = columns.indexOf(column);
      if (colIdx === -1) continue;
      const colNombres = uniqueColName(columns, "Nombre(s)");
      const colPaterno = uniqueColName([...columns, colNombres], "Apellido_Paterno");
      const colMaterno = uniqueColName(
        [...columns, colNombres, colPaterno],
        "Apellido_Materno"
      );

      columns = [
        ...columns.slice(0, colIdx + 1),
        colNombres,
        colPaterno,
        colMaterno,
        ...columns.slice(colIdx + 1),
      ];
      activeRows = activeRows.map((item) => {
        const parsed = splitLatinAmericanName(item.data[column] ?? "");
        return {
          ...item,
          data: {
            ...item.data,
            [colNombres]: parsed.nombres,
            [colPaterno]: parsed.apellidoPaterno,
            [colMaterno]: parsed.apellidoMaterno,
          },
        };
      });
      continue;
    }

    if (kind === "formula") {
      const expr = String(params?.expression ?? "").trim();
      if (!expr) continue;
      const mode = params?.mode === "new_column" ? "new_column" : "replace";
      const requestedTarget = String(params?.targetColumn ?? column).trim() || column;
      try {
        const ast = compileFormula(expr, columns);
        let finalTarget = requestedTarget;
        if (mode === "new_column" || !columns.includes(requestedTarget)) {
          finalTarget = uniqueColName(columns, requestedTarget);
          const colIdx = columns.indexOf(column);
          columns =
            colIdx >= 0
              ? [...columns.slice(0, colIdx + 1), finalTarget, ...columns.slice(colIdx + 1)]
              : [...columns, finalTarget];
        }
        activeRows = activeRows.map((item) => {
          const val = evaluateFormulaAst(ast, item.data);
          return {
            ...item,
            data: {
              ...item.data,
              [finalTarget]: val === null || val === undefined ? "" : String(val),
            },
          };
        });
      } catch {
        // Si una fórmula falla en replay, no borra ni rompe la receta; se omite con seguridad
      }
      continue;
    }

    if (kind === "delete_row") {
      const targetOrigIdx = Number(params?.origIdx ?? params?.rowIndex ?? -1);
      const nextActive: IndexedRow[] = [];
      for (const item of activeRows) {
        if (item.origIdx === targetOrigIdx) {
          trash.push({
            origIdx: item.origIdx,
            data: item.data,
            stepId: step.id,
            reason: step.label,
          });
        } else {
          nextActive.push(item);
        }
      }
      activeRows = nextActive;
      continue;
    }

    if (kind === "delete_empty_rows") {
      const nextActive: IndexedRow[] = [];
      for (const item of activeRows) {
        if ((item.data[column] ?? "").trim() === "") {
          trash.push({
            origIdx: item.origIdx,
            data: item.data,
            stepId: step.id,
            reason: step.label,
          });
        } else {
          nextActive.push(item);
        }
      }
      activeRows = nextActive;
      continue;
    }

    if (kind === "restore_rows") {
      const restoreSet = new Set<number>(
        ((params?.origIndices as number[] | undefined) ?? []).map(Number)
      );
      const restored: IndexedRow[] = [];
      trash = trash.filter((entry) => {
        if (restoreSet.has(entry.origIdx)) {
          restored.push({ origIdx: entry.origIdx, data: entry.data });
          return false;
        }
        return true;
      });
      if (restored.length > 0) {
        activeRows = [...activeRows, ...restored].sort((a, b) => a.origIdx - b.origIdx);
      }
      continue;
    }

    if (kind === "add_row") {
      const maxOrig = Math.max(
        -1,
        ...activeRows.map((r) => r.origIdx),
        ...trash.map((t) => t.origIdx)
      );
      const emptyData: DataRow = {};
      for (const c of columns) emptyData[c] = "";
      activeRows = [...activeRows, { origIdx: maxOrig + 1, data: emptyData }];
      continue;
    }

    if (kind === "add_column") {
      const desired = String(params?.newColumnName ?? "").trim() || `Columna_${columns.length + 1}`;
      const targetCol = uniqueColName(columns, desired);
      columns = [...columns, targetCol];
      activeRows = activeRows.map((item) => ({
        ...item,
        data: { ...item.data, [targetCol]: "" },
      }));
      continue;
    }

    if (kind === "computed_column") {
      const desired = String(params?.targetColumn ?? `${column}_DuckDB`).trim() || `${column}_DuckDB`;
      const targetCol = uniqueColName(columns, desired);
      const values = (params?.values as string[] | undefined) ?? [];
      const colIdx = columns.indexOf(column);
      columns =
        colIdx >= 0
          ? [...columns.slice(0, colIdx + 1), targetCol, ...columns.slice(colIdx + 1)]
          : [...columns, targetCol];
      activeRows = activeRows.map((item, idx) => ({
        ...item,
        data: { ...item.data, [targetCol]: values[idx] ?? "" },
      }));
      continue;
    }

    if (kind === "edit_cell") {
      const targetOrigIdx = Number(params?.origIdx ?? params?.rowIndex ?? -1);
      const nextValue = String(params?.newValue ?? "");
      activeRows = activeRows.map((item) =>
        item.origIdx === targetOrigIdx
          ? { ...item, data: { ...item.data, [column]: nextValue } }
          : item
      );
      continue;
    }

    if (kind === "promote_headers") {
      if (activeRows.length === 0) continue;
      const requestedOrigIdx =
        params?.rowOrigIdx !== undefined ? Number(params.rowOrigIdx) : activeRows[0].origIdx;
      const headerRowIdx = activeRows.findIndex((r) => r.origIdx === requestedOrigIdx);
      const chosenIdx = headerRowIdx >= 0 ? headerRowIdx : 0;
      const headerRow = activeRows[chosenIdx];

      const newColumns: string[] = [];
      const oldToNew = new Map<string, string>();
      columns.forEach((oldCol, idx) => {
        const rawCandidate = (headerRow.data[oldCol] ?? "").trim() || `Columna_${idx + 1}`;
        const unique = uniqueColName(newColumns, rawCandidate);
        newColumns.push(unique);
        oldToNew.set(oldCol, unique);
      });

      trash.push({
        origIdx: headerRow.origIdx,
        data: headerRow.data,
        stepId: step.id,
        reason: step.label,
      });

      columns = newColumns;
      activeRows = activeRows
        .filter((_, idx) => idx !== chosenIdx)
        .map((item) => {
          const nextData: DataRow = {};
          for (const [oldCol, newCol] of oldToNew.entries()) {
            nextData[newCol] = item.data[oldCol] ?? "";
          }
          return { ...item, data: nextData };
        });
      continue;
    }

    if (kind === "remove_duplicates") {
      const scope = params?.scope === "row" ? "row" : "column";
      const keep = params?.keep === "last" ? "last" : "first";
      const getKey = (item: IndexedRow): string =>
        scope === "row" ? serializeRowSignature(item.data, columns) : item.data[column] ?? "";

      const seen = new Set<string>();
      const keptFlags = new Array<boolean>(activeRows.length).fill(true);

      if (keep === "first") {
        for (let i = 0; i < activeRows.length; i++) {
          const k = getKey(activeRows[i]);
          if (scope === "column" && k.trim() === "") continue;
          if (seen.has(k)) keptFlags[i] = false;
          else seen.add(k);
        }
      } else {
        for (let i = activeRows.length - 1; i >= 0; i--) {
          const k = getKey(activeRows[i]);
          if (scope === "column" && k.trim() === "") continue;
          if (seen.has(k)) keptFlags[i] = false;
          else seen.add(k);
        }
      }

      const nextActive: IndexedRow[] = [];
      for (let i = 0; i < activeRows.length; i++) {
        if (keptFlags[i]) {
          nextActive.push(activeRows[i]);
        } else {
          trash.push({
            origIdx: activeRows[i].origIdx,
            data: activeRows[i].data,
            stepId: step.id,
            reason: step.label,
          });
        }
      }
      activeRows = nextActive;
      continue;
    }

    if (kind === "remove_error_rows") {
      const nextActive: IndexedRow[] = [];
      for (const item of activeRows) {
        if (isErrorCellValue(item.data[column] ?? "")) {
          trash.push({
            origIdx: item.origIdx,
            data: item.data,
            stepId: step.id,
            reason: step.label,
          });
        } else {
          nextActive.push(item);
        }
      }
      activeRows = nextActive;
      continue;
    }

    if (kind === "split_column_flexible") {
      const colIdx = columns.indexOf(column);
      if (colIdx === -1) continue;
      const mode = params?.mode === "length" ? "length" : "delimiter";
      const delimiter = String(params?.delimiter ?? ",");
      const maxParts = params?.maxParts !== undefined ? Number(params.maxParts) : undefined;
      const length = params?.length !== undefined ? Number(params.length) : 4;

      const splitMatrix = activeRows.map((item) =>
        splitFlexibleParts(item.data[column] ?? "", { mode, delimiter, maxParts, length })
      );
      const numCols = Math.max(1, ...splitMatrix.map((parts) => parts.length));
      const newColNames: string[] = [];
      for (let p = 0; p < numCols; p++) {
        const nextName = uniqueColName([...columns, ...newColNames], `${column}_${p + 1}`);
        newColNames.push(nextName);
      }

      columns = [
        ...columns.slice(0, colIdx + 1),
        ...newColNames,
        ...columns.slice(colIdx + 1),
      ];

      activeRows = activeRows.map((item, rIdx) => {
        const parts = splitMatrix[rIdx];
        const nextData: DataRow = { ...item.data };
        newColNames.forEach((colName, pIdx) => {
          nextData[colName] = parts[pIdx] ?? "";
        });
        return { ...item, data: nextData };
      });
      continue;
    }

    if (kind === "merge_columns") {
      const sourceCols = ((params?.sourceColumns as string[] | undefined) ?? []).filter((c) =>
        columns.includes(c)
      );
      if (sourceCols.length < 2) continue;
      const separator = String(params?.separator ?? " ");
      const desiredTarget = String(params?.targetColumn ?? "").trim() || sourceCols.join("_");
      const targetCol = uniqueColName(columns, desiredTarget);
      const hideSources = Boolean(params?.hideSources);

      const insertAfter = Math.max(...sourceCols.map((c) => columns.indexOf(c)));
      let nextColumns = [
        ...columns.slice(0, insertAfter + 1),
        targetCol,
        ...columns.slice(insertAfter + 1),
      ];

      if (hideSources) {
        const toHide = sourceCols.filter((c) => nextColumns.length > 1 && c !== targetCol);
        for (const c of toHide) {
          if (nextColumns.length > 1) {
            nextColumns = nextColumns.filter((col) => col !== c);
            if (!hiddenColumns.includes(c)) hiddenColumns.push(c);
          }
        }
      }

      columns = nextColumns;
      activeRows = activeRows.map((item) => {
        const joined = sourceCols
          .map((c) => (item.data[c] ?? "").trim())
          .filter((v) => v !== "")
          .join(separator);
        return {
          ...item,
          data: { ...item.data, [targetCol]: joined },
        };
      });
      continue;
    }

    if (kind === "unpivot_columns") {
      const colsToUnpivot = ((params?.columnsToUnpivot as string[] | undefined) ?? []).filter((c) =>
        columns.includes(c)
      );
      if (colsToUnpivot.length === 0) continue;
      const keepCols = columns.filter((c) => !colsToUnpivot.includes(c));
      const attrCol = uniqueColName(
        keepCols,
        String(params?.attributeColumn ?? "Atributo").trim() || "Atributo"
      );
      const valCol = uniqueColName(
        [...keepCols, attrCol],
        String(params?.valueColumn ?? "Valor").trim() || "Valor"
      );

      columns = [...keepCols, attrCol, valCol];
      const nextRows: IndexedRow[] = [];
      for (const item of activeRows) {
        colsToUnpivot.forEach((uCol, uIdx) => {
          const nextData: DataRow = {};
          for (const k of keepCols) {
            nextData[k] = item.data[k] ?? "";
          }
          nextData[attrCol] = uCol;
          nextData[valCol] = item.data[uCol] ?? "";
          nextRows.push({
            origIdx: item.origIdx * Math.max(100, colsToUnpivot.length) + uIdx,
            data: nextData,
          });
        });
      }
      activeRows = nextRows;
      continue;
    }

    if (kind === "fill_down") {
      let lastValid = "";
      activeRows = activeRows.map((item) => {
        const val = item.data[column] ?? "";
        if (val.trim() !== "") {
          lastValid = val;
          return item;
        }
        return lastValid ? { ...item, data: { ...item.data, [column]: lastValid } } : item;
      });
      continue;
    }

    if (kind === "fill_up") {
      let nextValid = "";
      const nextList = new Array<IndexedRow>(activeRows.length);
      for (let i = activeRows.length - 1; i >= 0; i--) {
        const item = activeRows[i];
        const val = item.data[column] ?? "";
        if (val.trim() !== "") {
          nextValid = val;
          nextList[i] = item;
        } else {
          nextList[i] = nextValid
            ? { ...item, data: { ...item.data, [column]: nextValid } }
            : item;
        }
      }
      activeRows = nextList;
      continue;
    }

    activeRows = activeRows.map((item) => {
      const val = item.data[column] ?? "";
      let next = val;
      switch (kind) {
        case "trim":
          next = val.trim().replace(/\s{2,}/g, " ");
          break;
        case "clean_deep":
          next = deepCleanText(val);
          break;
        case "title_case":
          next = toTitleCase(val);
          break;
        case "upper_case":
          next = val.toUpperCase();
          break;
        case "lower_case":
          next = val.toLowerCase();
          break;
        case "strip_accents":
          next = stripDiacritics(val);
          break;
        case "extract_numbers":
          next = extractCleanNumber(val);
          break;
        case "pad_postal_code":
          next = padMexicanPostalCode(val);
          break;
        case "split_keep_left": {
          const sep = String(params?.separator ?? "-");
          const parts = val.split(sep);
          next = (parts[0] ?? val).trim();
          break;
        }
        case "split_keep_right": {
          const sep = String(params?.separator ?? "-");
          const parts = val.split(sep);
          next = (parts.length > 1 ? parts.slice(1).join(sep) : val).trim();
          break;
        }
        case "extract_text":
          next = applyExtractText(val, {
            mode:
              (params?.mode as "before" | "after" | "between" | "first_n" | "last_n") ??
              "before",
            delimiter: params?.delimiter !== undefined ? String(params.delimiter) : undefined,
            endDelimiter:
              params?.endDelimiter !== undefined ? String(params.endDelimiter) : undefined,
            count: params?.count !== undefined ? Number(params.count) : undefined,
          });
          break;
        case "replace_value":
          next = applyReplaceValue(val, {
            find: String(params?.find ?? ""),
            replace: String(params?.replace ?? ""),
            matchMode:
              (params?.matchMode as "exact" | "contains" | "regex") ?? "contains",
            caseSensitive: Boolean(params?.caseSensitive),
          });
          break;
        case "replace_errors":
          if (isErrorCellValue(val)) {
            next = String(params?.replacement ?? "");
          }
          break;
        case "cast_column_type":
          next = applyCastColumnValue(
            val,
            (params?.targetType as ColumnDataType) ?? "text",
            (params?.onError as "mark" | "null" | "keep") ?? "mark"
          );
          break;
        case "standardize_dates":
          next = standardizeDateValue(val, (params?.format as DateTargetFormat) ?? "iso");
          break;
        case "fill_empty_default":
          next = val.trim() === "" ? String(params?.replacement ?? "Sin dato") : val;
          break;
        case "rename_facet": {
          const fromValue = String(params?.fromValue ?? "");
          const toValue = String(params?.toValue ?? "");
          if (val === fromValue) next = toValue;
          break;
        }
        case "merge_cluster": {
          const targets = (params?.variants as string[] | undefined) ?? [];
          const canonical = String(params?.canonical ?? "");
          if (targets.includes(val)) next = canonical;
          break;
        }
      }
      return next === val ? item : { ...item, data: { ...item.data, [column]: next } };
    });
  }

  return { columns, hiddenColumns, activeRows, trash };
}
