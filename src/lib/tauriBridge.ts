import { save } from "@tauri-apps/plugin-dialog";
import type { ClusterGroup, DataRow, FacetItem } from "../types/refine";
import { computeClusters, computeFacets } from "./refineEngine";

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

/**
 * Abre el cuadro nativo "Guardar como..." del sistema operativo en Tauri Desktop
 * (Windows, macOS, Linux) y escribe el archivo en la ruta elegida.
 * En navegador web, realiza la descarga estándar por Blob.
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

  triggerBrowserDownload(options.defaultName, options.data, options.mimeType);
  return { status: "web" };
}
