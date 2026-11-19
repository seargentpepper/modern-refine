import type {
  DataRow,
  SourceConnectionParams,
  SourceDescriptor,
  SourcePreviewData,
  SourceSnapshotData,
  SourceTableSchema,
} from "../types/refine";
import { parseCsvText } from "./refineEngine";

function toCellText(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function parseJsonTabularClient(
  sourceName: string,
  parsed: unknown,
  limit?: number
): SourcePreviewData {
  let rawItems: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const candidateKey = ["data", "results", "items", "rows", "value", "records"].find((k) =>
      Array.isArray(obj[k])
    );
    rawItems = candidateKey ? (obj[candidateKey] as unknown[]) : [obj];
  } else {
    throw new Error("El JSON no contiene objetos ni arreglos tabulares.");
  }

  const total = rawItems.length;
  const slice = limit !== undefined ? rawItems.slice(0, limit) : rawItems;

  const colSet = new Set<string>();
  const rows: DataRow[] = [];

  for (const item of slice) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row: DataRow = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        colSet.add(k);
        row[k] = toCellText(v);
      }
      rows.push(row);
    } else {
      colSet.add("Valor");
      rows.push({ Valor: toCellText(item) });
    }
  }

  const columns = Array.from(colSet);
  const normalizedRows = rows.map((r) => {
    const out: DataRow = {};
    for (const c of columns) out[c] = r[c] ?? "";
    return out;
  });

  return {
    sourceName,
    columns,
    sampleRows: normalizedRows,
    totalEstimatedRows: total,
    tables: [
      {
        name: sourceName,
        columns,
        rowCountHint: total,
      },
    ],
  };
}

export interface ParsedHtmlTableResult {
  name: string;
  columns: string[];
  rows: DataRow[];
}

export function parseHtmlTablesClient(html: string): ParsedHtmlTableResult[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tableEls = Array.from(doc.querySelectorAll("table"));
  const results: ParsedHtmlTableResult[] = [];

  tableEls.forEach((table) => {
    const trs = Array.from(table.querySelectorAll("tr"));
    if (trs.length < 2) return;

    let columns: string[] = [];
    const rows: DataRow[] = [];

    trs.forEach((tr, rIdx) => {
      const cellEls = Array.from(tr.children).filter(
        (el) => el.tagName === "TH" || el.tagName === "TD"
      );
      if (cellEls.length === 0) return;

      const allHeaders = cellEls.every((el) => el.tagName === "TH");
      if (columns.length === 0 && (rIdx === 0 || allHeaders)) {
        const seen = new Map<string, number>();
        columns = cellEls.map((el, cIdx) => {
          const base =
            (el.textContent ?? "")
              .replace(/\[\d+\]/g, "")
              .replace(/\s+/g, " ")
              .trim() || `Columna_${cIdx + 1}`;
          const count = (seen.get(base) ?? 0) + 1;
          seen.set(base, count);
          return count > 1 ? `${base}_${count}` : base;
        });
        return;
      }

      if (columns.length === 0) return;

      const row: DataRow = {};
      columns.forEach((col, cIdx) => {
        const raw = cellEls[cIdx]?.textContent ?? "";
        row[col] = raw.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
      });
      if (Object.values(row).some((v) => v !== "")) {
        rows.push(row);
      }
    });

    if (columns.length >= 2 && rows.length > 0) {
      const caption =
        table.querySelector("caption")?.textContent?.replace(/\s+/g, " ").trim() ||
        `Tabla ${results.length + 1}`;
      results.push({ name: caption, columns, rows });
    }
  });

  return results;
}

export function resolveWikipediaTarget(
  rawInput: string,
  lang = "es"
): { apiUrl: string; title: string } {
  const trimmed = rawInput.trim();
  const wikiMatch = /^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^#?]+)/i.exec(trimmed);
  const resolvedLang = wikiMatch ? wikiMatch[1] : lang;
  const pageTitle = wikiMatch ? decodeURIComponent(wikiMatch[2]) : trimmed.replace(/\s+/g, "_");
  const apiUrl = `https://${resolvedLang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json&origin=*`;
  return { apiUrl, title: pageTitle.replace(/_/g, " ") };
}

export async function fetchWebSourceInBrowser(
  params: SourceConnectionParams,
  limit?: number
): Promise<{ preview: SourcePreviewData; snapshot: SourceSnapshotData }> {
  if (params.kind === "wikipedia") {
    const rawTarget = (params.url ?? "").trim();
    if (!rawTarget) throw new Error("Ingresa un artículo o URL de Wikipedia.");
    const { apiUrl, title } = resolveWikipediaTarget(rawTarget);
    const resp = await fetch(apiUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al consultar Wikipedia.`);
    const json = (await resp.json()) as {
      error?: { info?: string };
      parse?: { title?: string; text?: { "*"?: string } };
    };
    if (json.error) throw new Error(json.error.info || "Artículo no encontrado en Wikipedia.");
    const html = json.parse?.text?.["*"] ?? "";
    const tables = parseHtmlTablesClient(html);
    if (tables.length === 0) {
      throw new Error("No se encontraron tablas estructuradas en este artículo de Wikipedia.");
    }
    const chosenIdx = Math.min(Math.max(0, params.tableIndex ?? 0), tables.length - 1);
    const chosen = tables[chosenIdx];
    const tableSchemas: SourceTableSchema[] = tables.map((t) => ({
      name: t.name,
      columns: t.columns,
      rowCountHint: t.rows.length,
    }));
    const sourceName = `${json.parse?.title ?? title} — ${chosen.name}`;
    return {
      preview: {
        sourceName,
        columns: chosen.columns,
        sampleRows: chosen.rows.slice(0, limit ?? 100),
        totalEstimatedRows: chosen.rows.length,
        tables: tableSchemas,
      },
      snapshot: {
        sourceName,
        columns: chosen.columns,
        rows: chosen.rows,
        delimiterLabel: "Wikipedia HTML",
      },
    };
  }

  const url = (params.url ?? "").trim();
  if (!url) throw new Error("Ingresa una URL válida.");
  const headers: Record<string, string> = { ...(params.headers ?? {}) };
  if (params.auth?.method === "bearer" && params.auth.password) {
    headers["Authorization"] = `Bearer ${params.auth.password}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Error HTTP ${resp.status} al conectar con ${url}`);
  }
  const text = await resp.text();
  const sourceName = url.split("/").filter(Boolean).pop()?.split("?")[0] || "Web_Snapshot";
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const jsonVal = JSON.parse(trimmed);
    const full = parseJsonTabularClient(sourceName, jsonVal);
    return {
      preview: {
        ...full,
        sampleRows: full.sampleRows.slice(0, limit ?? 100),
      },
      snapshot: {
        sourceName,
        columns: full.columns,
        rows: full.sampleRows,
        delimiterLabel: "Web JSON",
      },
    };
  }

  const csvParsed = parseCsvText(text);
  if (csvParsed.columns.length === 0) {
    throw new Error("La respuesta web no contiene datos CSV o JSON válidos.");
  }
  return {
    preview: {
      sourceName,
      columns: csvParsed.columns,
      sampleRows: csvParsed.rows.slice(0, limit ?? 100),
      totalEstimatedRows: csvParsed.rows.length,
      tables: [
        {
          name: sourceName,
          columns: csvParsed.columns,
          rowCountHint: csvParsed.rows.length,
        },
      ],
    },
    snapshot: {
      sourceName,
      columns: csvParsed.columns,
      rows: csvParsed.rows,
      delimiterLabel: csvParsed.meta.delimiterLabel,
    },
  };
}

/**
 * Sanitiza la configuración de origen para guardarla en `.refine.json`.
 * Garantiza que contraseñas y tokens NUNCA se escriban en el archivo de receta.
 */
export function sanitizeSourceDescriptor(
  params: SourceConnectionParams,
  displayName: string
): SourceDescriptor {
  return {
    kind: params.kind,
    displayName,
    url: params.kind === "web_json" || params.kind === "wikipedia" ? params.url : undefined,
    sqlDialect: params.kind === "sql" ? params.sqlDialect : undefined,
    server: params.kind === "sql" ? params.server : undefined,
    database: params.kind === "sql" ? params.database : undefined,
    tableOrQuery: params.customSqlQuery?.trim() || params.tableOrQuery,
    scopeLevel: params.auth?.scopeLevel,
  };
}

const sessionCredentialCache = new Map<string, { username: string; password: string }>();

export function saveScopedCredentialMemory(
  scopeLevel: string,
  username: string,
  password: string
): void {
  if (!scopeLevel) return;
  sessionCredentialCache.set(scopeLevel, { username, password });
}

export function loadScopedCredentialMemory(
  scopeLevel: string
): { username: string; password: string } | null {
  return sessionCredentialCache.get(scopeLevel) ?? null;
}
