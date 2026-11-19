import { save } from "@tauri-apps/plugin-dialog";
import type {
  ClusterGroup,
  ColumnQualityProfile,
  DataRow,
  DuckDbStatus,
  DuckQueryResult,
  FacetItem,
  SourceConnectionParams,
  SourcePreviewData,
  SourceSnapshotData,
} from "../types/refine";
import { computeClusters, computeColumnQualityProfile, computeFacets } from "./refineEngine";
import { fetchWebSourceInBrowser } from "./sourceParsers";

interface TauriInternals {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function getTauriInvoke(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return typeof w.__TAURI_INTERNALS__?.invoke === "function"
    ? w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__)
    : null;
}

export function isTauriDesktopRuntime(): boolean {
  return getTauriInvoke() !== null;
}

/**
 * Puente híbrido: si corre dentro del contenedor nativo Tauri v2 invoca el crate Rust
 * `modern_refine_engine`; si corre en navegador (Vite dev) usa el motor local equivalente.
 */
export async function computeClustersBridge(
  _sessionId: string,
  column: string,
  rows: DataRow[],
  facets: FacetItem[]
): Promise<ClusterGroup[]> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const tupleFacets = facets
        .filter((f) => !f.isEmpty)
        .map((f) => [f.value, f.count] as [string, number]);
      return await invoke<ClusterGroup[]>("refine_cluster", {
        column,
        facets: tupleFacets,
      });
    } catch {
      // Fallback seguro al motor determinista en memoria
    }
  }
  return computeClusters(rows, column);
}

export function computeFacetsBridge(rows: DataRow[], column: string): FacetItem[] {
  return computeFacets(rows, column);
}

export async function profileColumnBridge(
  rows: DataRow[],
  column: string
): Promise<ColumnQualityProfile> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const values = rows.map((r) => r[column] ?? "");
      await invoke("refine_profile_column", { column, values });
    } catch {
      // Fallback seguro al motor determinista en memoria
    }
  }
  return computeColumnQualityProfile(rows, column);
}

export async function previewExternalSourceBridge(
  params: SourceConnectionParams
): Promise<SourcePreviewData> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return await invoke<SourcePreviewData>("preview_external_source", { params });
  }
  if (params.kind === "sql") {
    const server = params.server?.trim() || "(sin servidor)";
    const db = params.database?.trim() || "por defecto";
    const target = params.customSqlQuery?.trim() || params.tableOrQuery?.trim() || "dbo.Tabla";
    throw new Error(
      `Modo Navegador: las conexiones TCP hacia SQL (${server} / ${db}, consulta "${target}") requieren ejecutar ModernRefine como app de escritorio Tauri (\`npm run dev:desktop\`).`
    );
  }
  const { preview } = await fetchWebSourceInBrowser(params, 100);
  return preview;
}

export async function fetchExternalSnapshotBridge(
  params: SourceConnectionParams
): Promise<SourceSnapshotData> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return await invoke<SourceSnapshotData>("fetch_external_snapshot", { params });
  }
  if (params.kind === "sql") {
    throw new Error(
      "Modo Navegador: las conexiones SQL requieren el runtime nativo Tauri (`npm run dev:desktop`)."
    );
  }
  const { snapshot } = await fetchWebSourceInBrowser(params);
  return snapshot;
}

export async function getDuckDbStatusBridge(): Promise<DuckDbStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    return {
      available: false,
      engine: "DuckDB Native (Solo disponible en Tauri Desktop)",
      version: "N/A (Modo Navegador)",
      activeTable: null,
      rowCount: 0,
    };
  }
  return await invoke<DuckDbStatus>("duckdb_engine_status");
}

export async function syncDuckDbSessionBridge(
  tableName: string,
  columns: string[],
  rows: DataRow[]
): Promise<DuckDbStatus> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "DuckDB Nativo (sin WASM) requiere ejecutar la app de escritorio Tauri (`npm run dev:desktop`)."
    );
  }
  return await invoke<DuckDbStatus>("duckdb_sync_session", {
    tableName,
    columns,
    rows,
  });
}

export async function queryDuckDbBridge(
  sql: string,
  limit = 500
): Promise<DuckQueryResult> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "Las consultas DuckDB Nativas requieren Tauri Desktop (`npm run dev:desktop`)."
    );
  }
  return await invoke<DuckQueryResult>("duckdb_query_preview", { sql, limit });
}

export async function groupByDuckDbBridge(
  tableName: string,
  columns: string[],
  rows: DataRow[],
  groupCol: string,
  valueCol: string,
  agg: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX"
): Promise<DuckQueryResult> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "Group By sobre DuckDB Nativo requiere Tauri Desktop (`npm run dev:desktop`)."
    );
  }
  return await invoke<DuckQueryResult>("duckdb_group_summary", {
    tableName,
    columns,
    rows,
    groupCol,
    valueCol,
    agg,
  });
}

export async function exportParquetWithDialogBridge(
  defaultBaseName: string,
  tableName: string,
  columns: string[],
  rows: DataRow[]
): Promise<SaveFileResult> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "La exportación nativa a Apache Parquet (.parquet) usa DuckDB Nativo y requiere Tauri Desktop (`npm run dev:desktop`)."
    );
  }
  const selectedPath = await save({
    defaultPath: `${defaultBaseName}.parquet`,
    filters: [{ name: "Apache Parquet", extensions: ["parquet"] }],
  });
  if (!selectedPath) {
    return { status: "cancelled" };
  }
  await invoke<void>("duckdb_export_parquet", {
    tableName,
    columns,
    rows,
    outPath: selectedPath,
  });
  return { status: "saved", path: selectedPath };
}

export async function evaluateWindowMagicBridge(
  tableName: string,
  columns: string[],
  rows: DataRow[],
  fnName: "RUNNING_SUM" | "PCT_OF_TOTAL" | "GROUP_AVG" | "ROW_NUM" | "IS_OUTLIER",
  valueCol: string,
  partitionCol?: string
): Promise<string[]> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "Las fórmulas de ventana DuckDB Nativas requieren Tauri Desktop (`npm run dev:desktop`)."
    );
  }
  return await invoke<string[]>("duckdb_evaluate_window_magic", {
    tableName,
    columns,
    rows,
    fnName,
    valueCol,
    partitionCol: partitionCol || null,
  });
}

export interface SaveFileOptions {
  defaultName: string;
  filterName: string;
  extensions: string[];
  data: string | Uint8Array;
  mimeType: string;
}

export type SaveFileResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "web" };

function triggerBrowserDownload(filename: string, data: string | Uint8Array, mimeType: string) {
  const blobPart: BlobPart =
    typeof data === "string" ? data : new Uint8Array(data);
  const blob = new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface FileSystemWritableStreamLike {
  write: (data: BlobPart) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableStreamLike>;
}

interface WindowWithFilePicker {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandleLike>;
}

/**
 * Abre el cuadro nativo "Guardar como..." del sistema operativo en Tauri Desktop
 * (Windows, macOS, Linux) y escribe el archivo en la ruta elegida.
 * En navegador web (Chrome/Edge), intenta usar la File System Access API
 * (`showSaveFilePicker`) para abrir también la ventana clásica de Windows,
 * con fallback a descarga estándar por Blob.
 */
export async function saveFileWithDialogBridge(
  options: SaveFileOptions
): Promise<SaveFileResult> {
  const invoke = getTauriInvoke();
  if (invoke) {
    const selectedPath = await save({
      defaultPath: options.defaultName,
      filters: [
        {
          name: options.filterName,
          extensions: options.extensions,
        },
      ],
    });
    if (!selectedPath) {
      return { status: "cancelled" };
    }
    const bytes =
      typeof options.data === "string"
        ? new TextEncoder().encode(options.data)
        : options.data;
    await invoke<void>("write_export_file", {
      path: selectedPath,
      bytes: Array.from(bytes),
    });
    return { status: "saved", path: selectedPath };
  }

  const win = typeof window !== "undefined" ? (window as unknown as WindowWithFilePicker) : null;
  if (win?.showSaveFilePicker) {
    try {
      const acceptExts = options.extensions.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
      const handle = await win.showSaveFilePicker({
        suggestedName: options.defaultName,
        types: [
          {
            description: options.filterName,
            accept: { [options.mimeType]: acceptExts },
          },
        ],
      });
      const writable = await handle.createWritable();
      const blobPart: BlobPart =
        typeof options.data === "string" ? options.data : new Uint8Array(options.data);
      await writable.write(blobPart);
      await writable.close();
      return { status: "saved", path: options.defaultName };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { status: "cancelled" };
      }
      // Si falla por seguridad/contexto, usar descarga estándar
    }
  }

  triggerBrowserDownload(options.defaultName, options.data, options.mimeType);
  return { status: "web" };
}
