import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  EyeOff,
  FileSpreadsheet,
  Filter,
  FolderInput,
  History,
  Pencil,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { ROOT_CSV_TEMPLATES } from "./data/csvTemplates";
import {
  computeClusters,
  computeColumnDiagnostic,
  computeFacets,
  isLikelyDateColumn,
  parseCalendarDate,
  parseCsvText,
  replayRecipeWithTrash,
  serializeCsv,
} from "./lib/refineEngine";
import { saveFileWithDialogBridge } from "./lib/tauriBridge";
import type {
  ClusterMethod,
  DataRow,
  DateTargetFormat,
  FileIngestionMeta,
  RefineStep,
  TableSession,
  TransformKind,
} from "./types/refine";

const DATE_FORMAT_LABELS: Record<DateTargetFormat, string> = {
  iso: "ISO AAAA-MM-DD (ej. 2025-01-14)",
  dmy_slash: "DD/MM/AAAA (ej. 14/01/2025)",
  ymd_slash: "AAAA/MM/DD (ej. 2025/01/14)",
  dmy_dash: "DD-MM-AAAA (ej. 14-01-2025)",
  mdy_slash: "MM/DD/AAAA (ej. 01/14/2025)",
  spanish_short: "DD-MMM-AAAA (ej. 14-ene-2025)",
  spanish_long: "Largo (14 de enero de 2025)",
};

function parseSortableNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function compareCellValues(a: string, b: string, isDateCol: boolean): number {
  const trimA = a.trim();
  const trimB = b.trim();
  if (!trimA && !trimB) return 0;
  if (!trimA) return 1;
  if (!trimB) return -1;

  if (isDateCol) {
    const dA = parseCalendarDate(trimA, true);
    const dB = parseCalendarDate(trimB, true);
    if (dA && dB) {
      const tA = Date.UTC(dA.year, dA.month - 1, dA.day);
      const tB = Date.UTC(dB.year, dB.month - 1, dB.day);
      if (tA !== tB) return tA - tB;
    }
  }

  const numA = parseSortableNumber(trimA);
  const numB = parseSortableNumber(trimB);
  if (numA !== null && numB !== null && numA !== numB) {
    return numA - numB;
  }

  return trimA.localeCompare(trimB, "es", { numeric: true, sensitivity: "base" });
}

interface StepAccordionGroup {
  key: string;
  title: string;
  steps: Array<{ step: RefineStep; globalIndex: number }>;
}

export default function App() {
  // Modelo de Sesiones Independientes (Multi-Pestaña / Multi-Archivo)
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const workbooksMapRef = useRef<Map<string, XLSX.WorkBook>>(new Map());

  const [clusterMethodFilter, setClusterMethodFilter] = useState<ClusterMethod | "ALL">("ALL");
  const [dateFormat, setDateFormat] = useState<DateTargetFormat>("iso");

  // Menús desplegables (Recetas / Exportar / Estructura de Columna)
  const [openMenu, setOpenMenu] = useState<"recipes" | "export" | "col_ops" | null>(null);
  const [isRenamingCol, setIsRenamingCol] = useState(false);
  const [renameColDraft, setRenameColDraft] = useState("");

  // Acordeones colapsados en el Historial
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Paginación virtualizada para tablas masivas (>100 filas)
  const [pageBySession, setPageBySession] = useState<Record<string, number>>({});
  const PAGE_SIZE = 100;

  const [leftTab, setLeftTab] = useState<"facets" | "clusters">("clusters");
  const [rightTab, setRightTab] = useState<"history" | "trash" | "recipe">("history");

  const [isEditingFilterAlias, setIsEditingFilterAlias] = useState(false);
  const [renamingFacetValue, setRenamingFacetValue] = useState<string | null>(null);
  const [renameFacetDraft, setRenameFacetDraft] = useState<string>("");

  const [editingCell, setEditingCell] = useState<{ origIdx: number; col: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const [clusterTargets, setClusterTargets] = useState<Record<string, string>>({});
  const [clusterUnchecked, setClusterUnchecked] = useState<Record<string, Set<string>>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recipeInputRef = useRef<HTMLInputElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId]
  );

  const updateActiveSession = useCallback(
    (updater: (prev: TableSession) => TableSession) => {
      setSessions((prev) => {
        const targetId = activeSessionId ?? prev[0]?.id;
        if (!targetId) return prev;
        return prev.map((s) => (s.id === targetId ? updater(s) : s));
      });
    },
    [activeSessionId]
  );

  const fileName = activeSession?.fileName ?? "";
  const baseColumns = activeSession?.baseColumns ?? [];
  const baseRows = activeSession?.baseRows ?? [];
  const ingestionMeta = activeSession?.ingestionMeta ?? null;
  const steps = activeSession?.steps ?? [];
  const redoStack = activeSession?.redoStack ?? [];
  const selectedColumn = activeSession?.selectedColumn ?? "";
  const selectionMode = activeSession?.selectionMode ?? "column";
  const sortState = activeSession?.sortState ?? null;
  const facetFilter = activeSession?.facetFilter ?? null;
  const filterAlias = activeSession?.filterAlias ?? "";
  const selectedCell = activeSession?.selectedCell ?? null;
  const workbookRef = activeSession ? workbooksMapRef.current.get(activeSession.id) ?? null : null;

  const { columns, hiddenColumns, activeRows, trash } = useMemo(
    () => replayRecipeWithTrash(baseRows, steps, baseColumns),
    [baseRows, steps, baseColumns]
  );

  const hasData = Boolean(activeSession && columns.length > 0);
  const currentDataRows = useMemo(() => activeRows.map((r) => r.data), [activeRows]);
  const activeColumn = columns.includes(selectedColumn) ? selectedColumn : columns[0] ?? "";

  const diagnostic = useMemo(
    () => (activeColumn ? computeColumnDiagnostic(currentDataRows, activeColumn) : null),
    [currentDataRows, activeColumn]
  );

  const facets = useMemo(
    () => (activeColumn ? computeFacets(currentDataRows, activeColumn) : []),
    [currentDataRows, activeColumn]
  );

  const clusters = useMemo(
    () => (activeColumn ? computeClusters(currentDataRows, activeColumn) : []),
    [currentDataRows, activeColumn]
  );

  const isDateCol = useMemo(
    () => (activeColumn ? isLikelyDateColumn(activeColumn, currentDataRows) : false),
    [activeColumn, currentDataRows]
  );

  useEffect(() => {
    if (clusters.length === 0 && facets.length > 0) {
      setLeftTab("facets");
    } else if (clusters.length > 0) {
      setLeftTab("clusters");
    }
  }, [activeColumn, clusters.length, facets.length]);

  const visibleRows = useMemo(() => {
    const filtered =
      facetFilter === null || !activeColumn
        ? activeRows
        : activeRows.filter((item) => (item.data[activeColumn] ?? "") === facetFilter);

    if (!sortState || !columns.includes(sortState.column)) return filtered;
    const sortCol = sortState.column;
    const colIsDate = isLikelyDateColumn(sortCol, currentDataRows);

    return [...filtered].sort((a, b) => {
      const valA = a.data[sortCol] ?? "";
      const valB = b.data[sortCol] ?? "";
      const trimA = valA.trim();
      const trimB = valB.trim();
      if (!trimA && !trimB) return a.origIdx - b.origIdx;
      if (!trimA) return 1;
      if (!trimB) return -1;
      const cmp = compareCellValues(valA, valB, colIsDate);
      return sortState.dir === "asc" ? cmp : -cmp;
    });
  }, [activeRows, facetFilter, activeColumn, sortState, columns, currentDataRows]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(
    totalPages - 1,
    Math.max(0, activeSession ? pageBySession[activeSession.id] ?? 0 : 0)
  );
  const pageOffset = currentPage * PAGE_SIZE;
  const pagedRows = useMemo(
    () => visibleRows.slice(pageOffset, pageOffset + PAGE_SIZE),
    [visibleRows, pageOffset]
  );

  // Agrupación del Historial en Acordeones por Columna / Tarea
  const stepAccordionGroups = useMemo<StepAccordionGroup[]>(() => {
    const groupsMap = new Map<string, StepAccordionGroup>();
    steps.forEach((step, idx) => {
      const isRowTask =
        step.kind === "delete_row" ||
        step.kind === "delete_empty_rows" ||
        step.kind === "restore_rows";
      const key = isRowTask ? "__rows__" : `col_${step.column}`;
      const title = isRowTask ? "Depuración de filas" : `Columna: ${step.column}`;
      const existing = groupsMap.get(key);
      if (existing) {
        existing.steps.push({ step, globalIndex: idx });
      } else {
        groupsMap.set(key, {
          key,
          title,
          steps: [{ step, globalIndex: idx }],
        });
      }
    });
    return Array.from(groupsMap.values());
  }, [steps]);

  const cleanTableName = useMemo(
    () => fileName.replace(/\.(csv|tsv|txt|xlsx|xls|ods|json)$/i, "") || "tabla_sin_nombre",
    [fileName]
  );

  const recipeJson = useMemo(
    () =>
      JSON.stringify(
        {
          schema: "modern-refine/v1",
          tableName: cleanTableName,
          sourceFile: fileName,
          activeSheet: ingestionMeta?.activeSheet ?? null,
          generatedAt: new Date().toISOString(),
          steps: steps.map(({ enabled, kind, column, label, params }) => ({
            enabled,
            kind,
            column,
            label,
            params,
          })),
        },
        null,
        2
      ),
    [cleanTableName, fileName, ingestionMeta, steps]
  );

  const openOrActivateSession = (
    name: string,
    cols: string[],
    rows: DataRow[],
    meta: FileIngestionMeta,
    wb?: XLSX.WorkBook
  ) => {
    if (cols.length === 0) return;
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (wb) {
      workbooksMapRef.current.set(id, wb);
    }
    const newSession: TableSession = {
      id,
      fileName: name,
      baseColumns: cols,
      baseRows: rows,
      ingestionMeta: meta,
      steps: [],
      redoStack: [],
      selectedColumn: cols[0],
      selectionMode: "column",
      sortState: null,
      facetFilter: null,
      filterAlias: "",
      selectedCell: rows.length > 0 ? { visibleIdx: 0, colIdx: 0 } : null,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(id);
    setEditingCell(null);
    setIsRenamingCol(false);
    setClusterMethodFilter("ALL");
  };

  const handleCloseSession = useCallback(
    (targetId?: string) => {
      const idToClose = targetId ?? activeSession?.id;
      if (!idToClose) return;
      workbooksMapRef.current.delete(idToClose);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === idToClose);
        if (idx === -1) return prev;
        const next = prev.filter((s) => s.id !== idToClose);
        if (activeSessionId === idToClose) {
          const fallback = next[Math.min(idx, next.length - 1)] ?? null;
          setActiveSessionId(fallback ? fallback.id : null);
        }
        return next;
      });
      setEditingCell(null);
      setIsRenamingCol(false);
    },
    [activeSession?.id, activeSessionId]
  );

  const loadCsvIntoSession = (name: string, rawText: string) => {
    // Si ya existe una pestaña con ese mismo nombre exacto, preguntar/activar o abrir pestaña
    const parsed = parseCsvText(rawText);
    if (parsed.columns.length === 0) return;
    openOrActivateSession(name, parsed.columns, parsed.rows, parsed.meta);
  };

  const loadWorkbookSheetIntoSession = (
    name: string,
    wb: XLSX.WorkBook,
    sheetName: string,
    replaceCurrentTab = false
  ) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    const parsed = parseCsvText(csvText);
    if (parsed.columns.length === 0) return;
    const meta: FileIngestionMeta = {
      delimiterLabel: `Hoja: ${sheetName}`,
      dedupedHeaders: parsed.meta.dedupedHeaders,
      sheets: wb.SheetNames,
      activeSheet: sheetName,
    };

    if (replaceCurrentTab && activeSession) {
      workbooksMapRef.current.set(activeSession.id, wb);
      updateActiveSession((s) => ({
        ...s,
        baseColumns: parsed.columns,
        baseRows: parsed.rows,
        ingestionMeta: meta,
        steps: [],
        redoStack: [],
        selectedColumn: parsed.columns[0],
        selectionMode: "column",
        sortState: null,
        facetFilter: null,
        filterAlias: "",
        selectedCell: parsed.rows.length > 0 ? { visibleIdx: 0, colIdx: 0 } : null,
      }));
    } else {
      openOrActivateSession(name, parsed.columns, parsed.rows, meta, wb);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", raw: false });
        const firstSheet = wb.SheetNames[0];
        if (firstSheet) {
          loadWorkbookSheetIntoSession(file.name, wb, firstSheet, false);
        }
      } else if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        try {
          const parsedJson = JSON.parse(text);
          const arr = Array.isArray(parsedJson)
            ? parsedJson
            : Array.isArray(parsedJson?.data)
              ? parsedJson.data
              : null;
          if (arr && arr.length > 0 && typeof arr[0] === "object") {
            const cols = Array.from(
              new Set<string>(
                arr.flatMap((obj: Record<string, unknown>) => Object.keys(obj ?? {}))
              )
            );
            const rows: DataRow[] = arr.map((obj: Record<string, unknown>) => {
              const r: DataRow = {};
              for (const c of cols) r[c] = obj?.[c] == null ? "" : String(obj[c]);
              return r;
            });
            openOrActivateSession(file.name, cols, rows, {
              delimiterLabel: "JSON",
              dedupedHeaders: 0,
            });
          }
        } catch {
          // Ignorar JSON inválido
        }
      } else {
        const text = await file.text();
        loadCsvIntoSession(file.name, text);
      }
    }
    e.target.value = "";
  };

  const handleSaveRecipe = useCallback(async () => {
    if (!hasData) return;
    setOpenMenu(null);
    try {
      await saveFileWithDialogBridge({
        defaultName: `${cleanTableName}.refine.json`,
        filterName: "Receta ModernRefine (*.refine.json)",
        extensions: ["json"],
        data: recipeJson,
        mimeType: "application/json",
      });
    } catch (err) {
      console.error("Error al guardar receta:", err);
    }
  }, [hasData, cleanTableName, recipeJson]);

  const handleExportCsv = useCallback(async () => {
    if (!hasData) return;
    setOpenMenu(null);
    try {
      const rowsToExport = visibleRows.map((r) => r.data);
      await saveFileWithDialogBridge({
        defaultName: `${cleanTableName}_limpio.csv`,
        filterName: "Archivo CSV (*.csv)",
        extensions: ["csv"],
        data: serializeCsv(columns, rowsToExport),
        mimeType: "text/csv;charset=utf-8",
      });
    } catch (err) {
      console.error("Error al exportar CSV:", err);
    }
  }, [hasData, cleanTableName, columns, visibleRows]);

  const handleExportXlsx = useCallback(async () => {
    if (!hasData) return;
    setOpenMenu(null);
    try {
      const rowsToExport = visibleRows.map((r) => r.data);
      const ws = XLSX.utils.json_to_sheet(rowsToExport, { header: columns });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, ingestionMeta?.activeSheet ?? "Limpio");
      const xlsxBuffer = XLSX.write(wb, {
        bookType: "xlsx",
        type: "array",
      }) as ArrayBuffer;
      await saveFileWithDialogBridge({
        defaultName: `${cleanTableName}_limpio.xlsx`,
        filterName: "Libro de Excel (*.xlsx)",
        extensions: ["xlsx"],
        data: new Uint8Array(xlsxBuffer),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    } catch (err) {
      console.error("Error al exportar XLSX:", err);
    }
  }, [hasData, cleanTableName, columns, visibleRows, ingestionMeta]);

  const handleLoadRecipe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { steps?: Array<Partial<RefineStep>> };
      if (!Array.isArray(parsed.steps)) return;
      const importedSteps: RefineStep[] = parsed.steps
        .filter((s) => typeof s.kind === "string" && typeof s.column === "string")
        .map((s, i) => ({
          id: `imported_${Date.now()}_${i}`,
          timestamp: s.timestamp ?? new Date().toISOString(),
          enabled: s.enabled !== false,
          kind: s.kind as TransformKind,
          column: String(s.column),
          label: String(s.label ?? `${s.kind} (${s.column})`),
          params: s.params,
        }));
      updateActiveSession((s) => ({
        ...s,
        steps: importedSteps,
        redoStack: [],
        facetFilter: null,
      }));
      setRightTab("history");
    } finally {
      e.target.value = "";
      setOpenMenu(null);
    }
  };

  const pushStep = useCallback(
    (
      kind: TransformKind,
      column: string,
      label: string,
      params?: Record<string, unknown>
    ) => {
      const step: RefineStep = {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        enabled: true,
        kind,
        column,
        label,
        params,
      };
      updateActiveSession((s) => ({
        ...s,
        steps: [...s.steps, step],
        redoStack: [],
        facetFilter: null,
        filterAlias: "",
      }));
    },
    [updateActiveSession]
  );

  const handleStandardizeWholeColumnDates = (fmt: DateTargetFormat = dateFormat) => {
    if (!activeColumn) return;
    updateActiveSession((s) => ({ ...s, selectionMode: "column" }));
    pushStep(
      "standardize_dates",
      activeColumn,
      `Homologar columna "${activeColumn}" → ${DATE_FORMAT_LABELS[fmt].split(" (")[0]}`,
      { format: fmt }
    );
  };

  const handleToggleStep = (stepId: string) => {
    updateActiveSession((s) => ({
      ...s,
      steps: s.steps.map((st) => (st.id === stepId ? { ...st, enabled: !st.enabled } : st)),
      facetFilter: null,
    }));
  };

  const handleToggleGroupSteps = (groupStepIds: string[], enableAll: boolean) => {
    const idSet = new Set(groupStepIds);
    updateActiveSession((s) => ({
      ...s,
      steps: s.steps.map((st) => (idSet.has(st.id) ? { ...st, enabled: enableAll } : st)),
      facetFilter: null,
    }));
  };

  const handleDeleteStep = (stepId: string) => {
    updateActiveSession((s) => ({
      ...s,
      steps: s.steps.filter((st) => st.id !== stepId),
      facetFilter: null,
    }));
  };

  const handleDeleteGroupSteps = (groupStepIds: string[]) => {
    const idSet = new Set(groupStepIds);
    updateActiveSession((s) => ({
      ...s,
      steps: s.steps.filter((st) => !idSet.has(st.id)),
      facetFilter: null,
    }));
  };

  const handleUndo = useCallback(() => {
    updateActiveSession((s) => {
      if (s.steps.length === 0) return s;
      const last = s.steps[s.steps.length - 1];
      return {
        ...s,
        steps: s.steps.slice(0, -1),
        redoStack: [last, ...s.redoStack],
        facetFilter: null,
      };
    });
  }, [updateActiveSession]);

  const handleRedo = useCallback(() => {
    updateActiveSession((s) => {
      if (s.redoStack.length === 0) return s;
      const [next, ...rest] = s.redoStack;
      return {
        ...s,
        steps: [...s.steps, next],
        redoStack: rest,
        facetFilter: null,
      };
    });
  }, [updateActiveSession]);

  // Atajos globales de teclado
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape" && openMenu) {
        setOpenMenu(null);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !isInput) {
        const altKey = e.key.toLowerCase();
        if (altKey === "w") {
          e.preventDefault();
          if (hasData) handleCloseSession();
          return;
        }
        if (hasData && activeColumn) {
          if (altKey === "d") {
            e.preventDefault();
            pushStep("duplicate_column", activeColumn, `Duplicar columna "${activeColumn}"`, {
              newColumnName: `${activeColumn}_Copia`,
            });
            return;
          }
          if (altKey === "r") {
            e.preventDefault();
            setRenameColDraft(activeColumn);
            setIsRenamingCol(true);
            return;
          }
          if (altKey === "x" && columns.length > 1) {
            e.preventDefault();
            pushStep("hide_column", activeColumn, `Ocultar columna "${activeColumn}"`);
            return;
          }
          if (altKey === "2") {
            e.preventDefault();
            pushStep(
              "split_into_two_columns",
              activeColumn,
              `Dividir "${activeColumn}" en 2 columnas (-)` ,
              { separator: "-" }
            );
            return;
          }
          if (altKey === "i") {
            e.preventDefault();
            pushStep(
              "split_keep_left",
              activeColumn,
              `Conservar izquierda antes de "-" (${activeColumn})`,
              { separator: "-" }
            );
            return;
          }
          if (altKey === "u") {
            e.preventDefault();
            pushStep(
              "split_keep_right",
              activeColumn,
              `Conservar derecha después de "-" (${activeColumn})`,
              { separator: "-" }
            );
            return;
          }
          if (altKey === "n") {
            e.preventDefault();
            pushStep(
              "split_mexican_name",
              activeColumn,
              `Separar "${activeColumn}" en Nombre(s), Apellido_Paterno y Apellido_Materno`
            );
            return;
          }
        }
      }

      if (!(e.ctrlKey || e.metaKey) || isInput) return;
      const key = e.key.toLowerCase();

      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === "y") {
        e.preventDefault();
        handleRedo();
      } else if (key === "o" && !e.shiftKey) {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if (key === "o" && e.shiftKey) {
        e.preventDefault();
        if (hasData) recipeInputRef.current?.click();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        handleSaveRecipe();
      } else if (key === "e" && !e.shiftKey) {
        e.preventDefault();
        handleExportCsv();
      } else if (key === "e" && e.shiftKey) {
        e.preventDefault();
        handleExportXlsx();
      }
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleSaveRecipe,
    handleExportCsv,
    handleExportXlsx,
    handleCloseSession,
    pushStep,
    hasData,
    activeColumn,
    columns.length,
    openMenu,
  ]);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenu]);

  const handleToggleColumnSort = (col: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateActiveSession((s) => {
      const prev = s.sortState;
      let nextSort: TableSession["sortState"] = null;
      if (!prev || prev.column !== col) nextSort = { column: col, dir: "asc" };
      else if (prev.dir === "asc") nextSort = { column: col, dir: "desc" };
      return { ...s, sortState: nextSort };
    });
  };

  const handleMergeCluster = (clusterId: string, canonicalChoice: string, allVariants: string[]) => {
    const unchecked = clusterUnchecked[clusterId] ?? new Set<string>();
    const variantsToMerge = allVariants.filter((v) => !unchecked.has(v));
    if (variantsToMerge.length === 0) return;
    const canonical = canonicalChoice.trim();
    if (!canonical) return;

    pushStep(
      "merge_cluster",
      activeColumn,
      `Fusionar ${variantsToMerge.length} variantes en "${canonical}" (${activeColumn})`,
      { variants: variantsToMerge, canonical }
    );
  };

  const toggleVariant = (clusterId: string, variant: string) => {
    setClusterUnchecked((prev) => {
      const nextSet = new Set(prev[clusterId] ?? []);
      if (nextSet.has(variant)) nextSet.delete(variant);
      else nextSet.add(variant);
      return { ...prev, [clusterId]: nextSet };
    });
  };

  const handleCommitCellEdit = () => {
    if (!editingCell) return;
    const target = activeRows.find((r) => r.origIdx === editingCell.origIdx);
    const original = target?.data[editingCell.col] ?? "";
    if (editDraft !== original) {
      pushStep(
        "edit_cell",
        editingCell.col,
        `Editar fila ${editingCell.origIdx + 1} (${editingCell.col}) → "${editDraft}"`,
        { origIdx: editingCell.origIdx, newValue: editDraft }
      );
    }
    setEditingCell(null);
  };

  const handleCommitFacetRename = (fromValue: string) => {
    const trimmed = renameFacetDraft;
    setRenamingFacetValue(null);
    if (trimmed === fromValue) return;
    pushStep(
      "rename_facet",
      activeColumn,
      `Renombrar "${fromValue || "(vacío)"}" → "${trimmed}" (${activeColumn})`,
      { fromValue, toValue: trimmed }
    );
  };

  const handleDeleteSelectedRow = () => {
    if (!selectedCell || !visibleRows[selectedCell.visibleIdx]) return;
    const targetOrigIdx = visibleRows[selectedCell.visibleIdx].origIdx;
    pushStep("delete_row", activeColumn, `Eliminar fila #${targetOrigIdx + 1}`, {
      origIdx: targetOrigIdx,
    });
    updateActiveSession((s) => ({
      ...s,
      selectedCell: s.selectedCell
        ? {
            visibleIdx: Math.max(0, Math.min(s.selectedCell.visibleIdx, visibleRows.length - 2)),
            colIdx: s.selectedCell.colIdx,
          }
        : null,
    }));
  };

  const handleRestoreRows = (origIndices: number[], label: string) => {
    if (origIndices.length === 0) return;
    pushStep("restore_rows", activeColumn, label, { origIndices });
  };

  const handleTableKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasData || visibleRows.length === 0 || editingCell) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    const current = selectedCell ?? { visibleIdx: 0, colIdx: 0 };
    let nextRow = current.visibleIdx;
    let nextCol = current.colIdx;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      nextRow = Math.min(visibleRows.length - 1, current.visibleIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nextRow = Math.max(0, current.visibleIdx - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nextCol = Math.min(columns.length - 1, current.colIdx + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextCol = Math.max(0, current.colIdx - 1);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      const targetRow = visibleRows[current.visibleIdx];
      const targetCol = columns[current.colIdx];
      if (targetRow && targetCol) {
        updateActiveSession((s) => ({ ...s, selectionMode: "cell" }));
        setEditingCell({ origIdx: targetRow.origIdx, col: targetCol });
        setEditDraft(targetRow.data[targetCol] ?? "");
      }
      return;
    } else {
      return;
    }

    const targetPage = Math.floor(nextRow / PAGE_SIZE);
    if (activeSession && targetPage !== currentPage) {
      setPageBySession((p) => ({ ...p, [activeSession.id]: targetPage }));
    }

    updateActiveSession((s) => ({
      ...s,
      selectionMode: "cell",
      selectedCell: { visibleIdx: nextRow, colIdx: nextCol },
      selectedColumn: columns[nextCol] ?? s.selectedColumn,
    }));
  };

  useEffect(() => {
    if (!selectedCell || selectionMode !== "cell" || !tableWrapRef.current) return;
    const cellEl = tableWrapRef.current.querySelector(
      `td[data-cell="${selectedCell.visibleIdx}-${selectedCell.colIdx}"]`
    );
    cellEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedCell, selectionMode]);

  const selectedRealRowIdx =
    selectionMode === "cell" && selectedCell && visibleRows[selectedCell.visibleIdx]
      ? visibleRows[selectedCell.visibleIdx].origIdx
      : null;

  return (
    <div className="mr-shell">
      {/* Top Bar */}
      <header className="mr-topbar">
        <div className="mr-brand">
          <span className="mr-logo">
            <img src="/mR_harmonia_cutout.png" alt="ModernRefine" className="mr-logo-img" />
            ModernRefine
          </span>
          <span className="mr-badge">Estación ETL</span>
          <span
            className="mr-file-pill"
            title={
              hasData
                ? `${fileName} · ${currentDataRows.length} filas${
                    ingestionMeta ? ` · ${ingestionMeta.delimiterLabel}` : ""
                  }`
                : "Sin archivo cargado"
            }
          >
            {hasData
              ? `${fileName} · ${currentDataRows.length} filas${
                  ingestionMeta ? ` · ${ingestionMeta.delimiterLabel}` : ""
                }`
              : "Sin archivo cargado"}
          </span>
          {workbookRef && ingestionMeta?.sheets && ingestionMeta.sheets.length > 1 && (
            <select
              className="mr-date-select"
              style={{ flex: "none", width: 140, height: 26 }}
              value={ingestionMeta.activeSheet ?? ""}
              onChange={(e) =>
                loadWorkbookSheetIntoSession(fileName, workbookRef, e.target.value, true)
              }
              title="Cambiar hoja de cálculo en la pestaña actual"
            >
              {ingestionMeta.sheets.map((sh) => (
                <option key={sh} value={sh}>
                  Hoja: {sh}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mr-actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <input
            ref={recipeInputRef}
            type="file"
            accept=".json,.refine.json,application/json"
            style={{ display: "none" }}
            onChange={handleLoadRecipe}
          />
          <button
            className="mr-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Abrir uno o varios archivos en pestañas independientes: CSV, TSV, Excel, ODS o JSON (Ctrl+O)"
          >
            <Upload size={14} /> Abrir
          </button>

          <button
            className="mr-btn"
            disabled={!hasData}
            onClick={() => handleCloseSession()}
            title="Cerrar pestaña de tabla activa (Alt+W)"
          >
            <X size={14} /> Cerrar
          </button>

          {ROOT_CSV_TEMPLATES.length > 0 && (
            <select
              className="mr-date-select"
              style={{ flex: "none", width: 185, height: 28 }}
              value=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                const tpl = ROOT_CSV_TEMPLATES.find((t) => t.name === val);
                if (tpl) loadCsvIntoSession(tpl.name, tpl.content);
              }}
              title="Abrir una plantilla de prueba en una nueva pestaña"
            >
              <option value="">+ Abrir Plantilla ({ROOT_CSV_TEMPLATES.length})</option>
              {ROOT_CSV_TEMPLATES.map((tpl) => (
                <option key={tpl.name} value={tpl.name}>
                  {tpl.name}
                </option>
              ))}
            </select>
          )}

          {/* Menú desplegable de Recetas */}
          <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
            <button
              className="mr-btn"
              disabled={!hasData}
              onClick={() => setOpenMenu(openMenu === "recipes" ? null : "recipes")}
              title="Cargar (Ctrl+Shift+O) o Guardar (Ctrl+S) recetas de transformación (.refine.json)"
            >
              <FileSpreadsheet size={14} /> Recetas <ChevronDown size={13} />
            </button>
            {openMenu === "recipes" && (
              <div className="mr-dropdown-menu">
                <button
                  className="mr-dropdown-item"
                  onClick={() => recipeInputRef.current?.click()}
                  title="Cargar archivo de receta previo en la tabla activa (Ctrl+Shift+O)"
                >
                  <span>
                    <FolderInput size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
                    Cargar Receta (.json)
                  </span>
                </button>
                <button
                  className="mr-dropdown-item"
                  onClick={handleSaveRecipe}
                  title={`Guardar receta para "${cleanTableName}" (Ctrl+S)`}
                >
                  <span>
                    <FileSpreadsheet
                      size={13}
                      style={{ verticalAlign: "middle", marginRight: 6 }}
                    />
                    Guardar "{cleanTableName}.refine.json"
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Menú desplegable de Exportar */}
          <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
            <button
              className="mr-btn mr-btn-primary"
              disabled={!hasData}
              onClick={() => setOpenMenu(openMenu === "export" ? null : "export")}
              title="Exportar tabla activa en Excel (Ctrl+Shift+E) o CSV (Ctrl+E)"
            >
              <Download size={14} /> Exportar <ChevronDown size={13} />
            </button>
            {openMenu === "export" && (
              <div className="mr-dropdown-menu">
                <button
                  className="mr-dropdown-item"
                  onClick={handleExportXlsx}
                  title="Exportar como libro Excel .xlsx (Ctrl+Shift+E)"
                >
                  <span>
                    <FileSpreadsheet
                      size={13}
                      style={{ verticalAlign: "middle", marginRight: 6 }}
                    />
                    Exportar en Excel (.xlsx)
                  </span>
                </button>
                <button
                  className="mr-dropdown-item"
                  onClick={handleExportCsv}
                  title="Exportar como archivo .csv (Ctrl+E)"
                >
                  <span>
                    <Download size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
                    Exportar en CSV (.csv)
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 3 Always-Visible Zones */}
      <div className="mr-workspace">
        {/* ZONE 1: Facets & Clusters */}
        <aside className="mr-zone mr-zone-left">
          <div className="mr-zone-header">
            <span>
              <Filter size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Facetas y Clústeres
            </span>
          </div>

          <div className="mr-scroll">
            {!hasData ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                Abre uno o varios archivos o elige una plantilla de la raíz para analizar sus
                facetas.
              </div>
            ) : (
              <>
                <select
                  className="mr-col-select"
                  value={activeColumn}
                  onChange={(e) => {
                    const col = e.target.value;
                    updateActiveSession((s) => ({
                      ...s,
                      selectedColumn: col,
                      selectionMode: "column",
                      facetFilter: null,
                      filterAlias: "",
                    }));
                  }}
                >
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      Columna seleccionada: {col}
                    </option>
                  ))}
                </select>

                {diagnostic && (
                  <div className="mr-diag-row">
                    <span className="mr-chip">{diagnostic.uniqueCount} variantes</span>
                    {diagnostic.emptyCount > 0 && (
                      <span className="mr-chip mr-chip-danger">{diagnostic.emptyCount} vacías</span>
                    )}
                    {diagnostic.whitespaceIssueCount > 0 && (
                      <span className="mr-chip mr-chip-warn">
                        {diagnostic.whitespaceIssueCount} espacios extra
                      </span>
                    )}
                    {diagnostic.suspiciousDateCount > 0 && (
                      <span className="mr-chip mr-chip-danger">
                        {diagnostic.suspiciousDateCount} fechas desbordadas
                      </span>
                    )}
                    {diagnostic.shortPostalCodeCount > 0 && (
                      <span className="mr-chip mr-chip-warn">
                        {diagnostic.shortPostalCodeCount} CP sin cero inicial
                      </span>
                    )}
                  </div>
                )}

                <div className="mr-tabs">
                  <button
                    className={`mr-tab ${leftTab === "clusters" ? "active" : ""}`}
                    onClick={() => setLeftTab("clusters")}
                  >
                    Clústeres ({clusters.length})
                  </button>
                  <button
                    className={`mr-tab ${leftTab === "facets" ? "active" : ""}`}
                    onClick={() => setLeftTab("facets")}
                  >
                    Facetas ({facets.length})
                  </button>
                </div>

                <div className="mr-quick-ops">
                  <button
                    className="mr-op-btn"
                    onClick={() => pushStep("trim", activeColumn, `Quitar espacios (${activeColumn})`)}
                  >
                    Quitar espacios
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep("upper_case", activeColumn, `MAYÚSCULAS (${activeColumn})`)
                    }
                  >
                    MAYÚSCULAS
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep("lower_case", activeColumn, `minúsculas (${activeColumn})`)
                    }
                  >
                    minúsculas
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep("title_case", activeColumn, `Tipo Título (${activeColumn})`)
                    }
                  >
                    Tipo Título
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep("strip_accents", activeColumn, `Quitar acentos (${activeColumn})`)
                    }
                  >
                    Sin acentos
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep(
                        "fill_empty_default",
                        activeColumn,
                        `Vacíos → "Sin dato" (${activeColumn})`,
                        { replacement: "Sin dato" }
                      )
                    }
                  >
                    Vacíos → Sin dato
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep("fill_down", activeColumn, `Rellenar hacia abajo (${activeColumn})`)
                    }
                  >
                    Rellenar abajo
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep(
                        "extract_numbers",
                        activeColumn,
                        `Extraer solo números (${activeColumn})`
                      )
                    }
                    title="Limpia símbolos de moneda, paréntesis o texto dejando solo dígitos"
                  >
                    Solo números
                  </button>
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep(
                        "pad_postal_code",
                        activeColumn,
                        `Normalizar CP a 5 dígitos (${activeColumn})`
                      )
                    }
                    title="Restaura el cero inicial en códigos postales de 4 dígitos (ej. 8600 → 08600)"
                  >
                    CP 5 dígitos (0...)
                  </button>
                  {diagnostic && diagnostic.emptyCount > 0 && (
                    <button
                      className="mr-op-btn mr-op-btn-danger"
                      onClick={() =>
                        pushStep(
                          "delete_empty_rows",
                          activeColumn,
                          `Eliminar filas sin "${activeColumn}"`
                        )
                      }
                    >
                      Eliminar filas vacías ({diagnostic.emptyCount})
                    </button>
                  )}

                  {/* Menú de ancho completo para Estructura, División, Nombres y Ocultar Columna */}
                  <div className="mr-col-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="mr-col-dropdown-trigger"
                      onClick={() => setOpenMenu(openMenu === "col_ops" ? null : "col_ops")}
                      title="Opciones para duplicar, renombrar, dividir o desaparecer esta columna"
                    >
                      <span>
                        <Columns3 size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
                        Estructura y División de Columna
                      </span>
                      <ChevronDown size={14} />
                    </button>
                    {openMenu === "col_ops" && (
                      <div className="mr-col-dropdown-panel">
                        <button
                          className="mr-dropdown-item"
                          title="Crea una copia exacta de esta columna a su derecha (Alt+D)"
                          onClick={() => {
                            pushStep(
                              "duplicate_column",
                              activeColumn,
                              `Duplicar columna "${activeColumn}"`,
                              { newColumnName: `${activeColumn}_Copia` }
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Duplicar columna</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          title="Cambiar el nombre del encabezado de esta columna (Alt+R)"
                          onClick={() => {
                            setRenameColDraft(activeColumn);
                            setIsRenamingCol(true);
                            setOpenMenu(null);
                          }}
                        >
                          <span>Renombrar columna...</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          disabled={columns.length <= 1}
                          style={{ color: "#fca5a5" }}
                          title="Oculta la columna de la vista y exportación sin destruir sus datos base (Alt+X)"
                          onClick={() => {
                            pushStep(
                              "hide_column",
                              activeColumn,
                              `Ocultar columna "${activeColumn}"`
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>
                            <EyeOff size={12} style={{ verticalAlign: "middle", marginRight: 6 }} />
                            Borrar (desaparecer) columna
                          </span>
                        </button>
                        <div className="mr-menu-divider" />
                        <button
                          className="mr-dropdown-item"
                          title="Crea 2 nuevas columnas contiguas separando por guion '-' (Alt+2)"
                          onClick={() => {
                            pushStep(
                              "split_into_two_columns",
                              activeColumn,
                              `Dividir "${activeColumn}" en 2 columnas (-)` ,
                              { separator: "-" }
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Dividir en 2 columnas (por "-")</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          title="Recorta la columna conservando el texto a la izquierda del guion (Alt+I)"
                          onClick={() => {
                            pushStep(
                              "split_keep_left",
                              activeColumn,
                              `Conservar izquierda antes de "-" (${activeColumn})`,
                              { separator: "-" }
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Conservar izquierda (antes de "-")</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          title="Recorta la columna conservando el texto a la derecha del guion (Alt+U)"
                          onClick={() => {
                            pushStep(
                              "split_keep_right",
                              activeColumn,
                              `Conservar derecha después de "-" (${activeColumn})`,
                              { separator: "-" }
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Conservar derecha (después de "-")</span>
                        </button>
                        <div className="mr-menu-divider" />
                        <button
                          className="mr-dropdown-item"
                          title="Crea las 3 columnas clásicas: Nombre(s), Apellido_Paterno y Apellido_Materno (Alt+N)"
                          onClick={() => {
                            pushStep(
                              "split_mexican_name",
                              activeColumn,
                              `Separar "${activeColumn}" en Nombre(s), Apellido_Paterno y Apellido_Materno`
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Separar en Nombre(s) + 2 Apellidos</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isRenamingCol && (
                  <div className="mr-filter-banner" style={{ marginBottom: 10 }}>
                    <input
                      className="mr-cell-input"
                      autoFocus
                      value={renameColDraft}
                      placeholder="Nuevo nombre de columna..."
                      onChange={(e) => setRenameColDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const nextName = renameColDraft.trim();
                          setIsRenamingCol(false);
                          if (nextName && nextName !== activeColumn) {
                            pushStep(
                              "rename_column",
                              activeColumn,
                              `Renombrar columna "${activeColumn}" → "${nextName}"`,
                              { newColumnName: nextName }
                            );
                            updateActiveSession((s) => ({ ...s, selectedColumn: nextName }));
                          }
                        } else if (e.key === "Escape") {
                          setIsRenamingCol(false);
                        }
                      }}
                    />
                    <button
                      className="mr-pick-btn"
                      onClick={() => {
                        const nextName = renameColDraft.trim();
                        setIsRenamingCol(false);
                        if (nextName && nextName !== activeColumn) {
                          pushStep(
                            "rename_column",
                            activeColumn,
                            `Renombrar columna "${activeColumn}" → "${nextName}"`,
                            { newColumnName: nextName }
                          );
                          updateActiveSession((s) => ({ ...s, selectedColumn: nextName }));
                        }
                      }}
                    >
                      Guardar
                    </button>
                  </div>
                )}

                {isDateCol && (
                  <div className="mr-date-bar" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#93c5fd" }}>
                      Homologar fechas de columna "{activeColumn}":
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        className="mr-date-select"
                        value={dateFormat}
                        onChange={(e) => setDateFormat(e.target.value as DateTargetFormat)}
                      >
                        {Object.entries(DATE_FORMAT_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="mr-btn mr-btn-primary"
                        style={{ height: 26, padding: "0 10px" }}
                        onClick={() => handleStandardizeWholeColumnDates(dateFormat)}
                      >
                        <CalendarCheck size={12} /> Homologar
                      </button>
                    </div>
                  </div>
                )}

                {leftTab === "clusters" ? (
                  clusters.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                      {isDateCol ? (
                        <>
                          <strong>{activeColumn}</strong> es una columna de fechas. Usa el botón{" "}
                          <strong>Homologar</strong> arriba o consulta la pestaña{" "}
                          <strong>Facetas</strong> para ver todos los valores.
                        </>
                      ) : (
                        <>
                          No se detectaron variantes textuales por fusionar en{" "}
                          <strong>{activeColumn}</strong>.
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="mr-diag-row" style={{ marginBottom: 8 }}>
                        {(
                          [
                            "ALL",
                            "Fingerprint",
                            "N-gram",
                            "Fonético ES",
                            "Levenshtein",
                            "Abreviatura",
                          ] as const
                        ).map((m) => (
                          <button
                            key={m}
                            className="mr-op-btn"
                            style={{
                              borderColor:
                                clusterMethodFilter === m ? "var(--accent)" : undefined,
                              background:
                                clusterMethodFilter === m ? "var(--accent-soft)" : undefined,
                            }}
                            onClick={() => setClusterMethodFilter(m)}
                          >
                            {m === "ALL" ? `Todos (${clusters.length})` : m}
                          </button>
                        ))}
                      </div>
                      {clusters
                        .filter(
                          (g) => clusterMethodFilter === "ALL" || g.method === clusterMethodFilter
                        )
                        .map((group) => {
                          const canonicalVal = clusterTargets[group.id] ?? group.suggestedCanonical;
                          const unchecked = clusterUnchecked[group.id] ?? new Set<string>();
                          const allVariants = group.variants.map((v) => v.value);
                          return (
                            <div key={group.id} className="mr-cluster-card">
                              <div className="mr-cluster-top">
                                <span>{group.variants.length} variantes similares</span>
                                <span className="mr-cluster-method">{group.method}</span>
                              </div>

                              {group.variants.map((v) => (
                                <div key={v.value} className="mr-cluster-variant">
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={!unchecked.has(v.value)}
                                      onChange={() => toggleVariant(group.id, v.value)}
                                    />
                                    <span title={v.value}>{v.value}</span>
                                  </label>
                                  <span className="mr-facet-actions">
                                    <span className="mr-facet-count">{v.count}</span>
                                    <button
                                      className="mr-pick-btn"
                                      title={`Fusionar todo el grupo en "${v.value.trim()}"`}
                                      onClick={() =>
                                        handleMergeCluster(group.id, v.value.trim(), allVariants)
                                      }
                                    >
                                      Elegir
                                    </button>
                                  </span>
                                </div>
                              ))}

                              <input
                                className="mr-cluster-input"
                                value={canonicalVal}
                                onChange={(e) =>
                                  setClusterTargets((prev) => ({
                                    ...prev,
                                    [group.id]: e.target.value,
                                  }))
                                }
                                placeholder="O escribe un nombre personalizado..."
                              />

                              <button
                                className="mr-btn mr-btn-primary"
                                style={{ width: "100%", justifyContent: "center" }}
                                onClick={() =>
                                  handleMergeCluster(group.id, canonicalVal, allVariants)
                                }
                              >
                                <CheckCircle2 size={14} /> Fusionar en "{canonicalVal}"
                              </button>
                            </div>
                          );
                        })}
                    </>
                  )
                ) : (
                  <div>
                    {facetFilter !== null && (
                      <div className="mr-filter-banner">
                        {isEditingFilterAlias ? (
                          <input
                            className="mr-cell-input"
                            autoFocus
                            value={filterAlias}
                            placeholder="Nombre del filtro..."
                            onChange={(e) =>
                              updateActiveSession((s) => ({ ...s, filterAlias: e.target.value }))
                            }
                            onBlur={() => setIsEditingFilterAlias(false)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") {
                                setIsEditingFilterAlias(false);
                              }
                            }}
                          />
                        ) : (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            Filtro:{" "}
                            <strong>
                              {filterAlias.trim() || (facetFilter || "(celda vacía)")}
                            </strong>
                          </span>
                        )}
                        <span className="mr-facet-actions">
                          <button
                            className="mr-icon-btn"
                            title="Renombrar etiqueta de filtro"
                            onClick={() => setIsEditingFilterAlias(true)}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="mr-icon-btn"
                            title="Quitar filtro"
                            onClick={() =>
                              updateActiveSession((s) => ({
                                ...s,
                                facetFilter: null,
                                filterAlias: "",
                              }))
                            }
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    )}

                    {facets.map((f) => {
                      const isRenamingThis = renamingFacetValue === f.value;
                      return (
                        <div
                          key={f.value || "__empty__"}
                          className={`mr-facet-item ${facetFilter === f.value ? "selected" : ""}`}
                          onClick={() => {
                            if (isRenamingThis) return;
                            updateActiveSession((s) => ({
                              ...s,
                              facetFilter: s.facetFilter === f.value ? null : f.value,
                              filterAlias: "",
                            }));
                          }}
                        >
                          {isRenamingThis ? (
                            <input
                              className="mr-cell-input"
                              autoFocus
                              value={renameFacetDraft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameFacetDraft(e.target.value)}
                              onBlur={() => handleCommitFacetRename(f.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCommitFacetRename(f.value);
                                if (e.key === "Escape") setRenamingFacetValue(null);
                              }}
                            />
                          ) : (
                            <span className={`mr-facet-label ${f.isEmpty ? "mr-facet-empty" : ""}`}>
                              {f.isEmpty ? "(celda vacía)" : f.value}
                            </span>
                          )}

                          <span className="mr-facet-actions">
                            <button
                              className="mr-icon-btn"
                              title="Renombrar este valor en toda la columna"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingFacetValue(f.value);
                                setRenameFacetDraft(f.value);
                              }}
                            >
                              <Pencil size={12} />
                            </button>
                            <span className="mr-facet-count">{f.count}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ZONE 2: Multi-Table Session Tabs & Editable Table */}
        <main className="mr-zone mr-zone-center">
          {/* Barra de pestañas de tablas abiertas */}
          {sessions.length > 0 && (
            <div className="mr-session-tabs">
              {sessions.map((sess) => {
                const isActive = sess.id === activeSession?.id;
                return (
                  <div
                    key={sess.id}
                    className={`mr-session-tab ${isActive ? "active" : ""}`}
                    onClick={() => setActiveSessionId(sess.id)}
                    title={`${sess.fileName} (${sess.steps.length} pasos aplicados)`}
                  >
                    <FileSpreadsheet size={13} color={isActive ? "#60a5fa" : "#808080"} />
                    <span>{sess.fileName}</span>
                    {sess.steps.length > 0 && (
                      <span className="mr-acc-badge">{sess.steps.length}</span>
                    )}
                    <button
                      type="button"
                      className="mr-session-close"
                      title="Cerrar esta tabla"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseSession(sess.id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mr-table-bar">
            <span style={{ fontWeight: 600 }}>
              {hasData
                ? `Vista de Tabla · ${visibleRows.length} de ${currentDataRows.length} filas${
                    sortState
                      ? ` · Ordenado por ${sortState.column} (${
                          sortState.dir === "asc" ? "A→Z / Menor a Mayor" : "Z→A / Mayor a Menor"
                        })`
                      : ""
                  }`
                : "Vista de Tabla"}
            </span>
            <div className="mr-actions">
              {totalPages > 1 && activeSession && (
                <>
                  <button
                    className="mr-btn"
                    disabled={currentPage <= 0}
                    onClick={() =>
                      setPageBySession((p) => ({
                        ...p,
                        [activeSession.id]: Math.max(0, currentPage - 1),
                      }))
                    }
                    title="Página anterior (100 filas por bloque)"
                  >
                    ◀
                  </button>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Pág. {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    className="mr-btn"
                    disabled={currentPage >= totalPages - 1}
                    onClick={() =>
                      setPageBySession((p) => ({
                        ...p,
                        [activeSession.id]: Math.min(totalPages - 1, currentPage + 1),
                      }))
                    }
                    title="Página siguiente (100 filas por bloque)"
                  >
                    ▶
                  </button>
                </>
              )}
              {sortState && (
                <button
                  className="mr-btn"
                  onClick={() => updateActiveSession((s) => ({ ...s, sortState: null }))}
                  title="Restablecer orden original de filas"
                >
                  ✕ Quitar orden
                </button>
              )}
              {hasData && (
                <button
                  className="mr-btn"
                  onClick={() => updateActiveSession((s) => ({ ...s, selectionMode: "column" }))}
                  title="Seleccionar todas las celdas de la columna actual"
                >
                  <Columns3 size={13} /> Seleccionar columna "{activeColumn}"
                </button>
              )}
              {(trash.length > 0 || hiddenColumns.length > 0) && (
                <button
                  className="mr-btn"
                  onClick={() => setRightTab("trash")}
                  title="Ver filas o columnas ocultas para restaurarlas"
                >
                  <Trash2 size={13} /> Papelera ({trash.length + hiddenColumns.length})
                </button>
              )}
              {selectedRealRowIdx !== null && (
                <button
                  className="mr-btn mr-btn-danger"
                  onClick={handleDeleteSelectedRow}
                  title="Eliminar la fila seleccionada"
                >
                  <Trash2 size={13} /> Eliminar fila #{selectedRealRowIdx + 1}
                </button>
              )}
            </div>
          </div>

          {hasData && selectionMode === "column" && isDateCol && (
            <div className="mr-col-banner">
              <span style={{ fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>
                ✓ Columna de fecha seleccionada: <strong>{activeColumn}</strong> ({visibleRows.length}{" "}
                filas)
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Nomenclatura de fecha:
                </span>
                <select
                  className="mr-date-select"
                  style={{ width: 220, height: 26 }}
                  value={dateFormat}
                  onChange={(e) => {
                    const fmt = e.target.value as DateTargetFormat;
                    setDateFormat(fmt);
                  }}
                >
                  {Object.entries(DATE_FORMAT_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="mr-btn mr-btn-primary"
                  style={{ height: 26 }}
                  onClick={() => handleStandardizeWholeColumnDates(dateFormat)}
                >
                  <CalendarCheck size={13} /> Reformatear toda la columna
                </button>
              </div>
            </div>
          )}

          {!hasData ? (
            <div className="mr-empty-state">
              <div className="mr-empty-card">
                <img
                  src="/mR_harmonia_cutout.png"
                  alt="ModernRefine"
                  style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }}
                />
                <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>
                  Listo para limpiar tus datos
                </h2>
                <p style={{ margin: "0 0 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Abre uno o varios archivos (<code>.xlsx</code>, <code>.csv</code>,{" "}
                  <code>.tsv</code>, <code>.ods</code> o <code>.json</code>) en pestañas simultáneas
                  o prueba con una plantilla de la raíz.
                </p>

                <button
                  className="mr-btn mr-btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  title="Abrir uno o varios archivos de datos (Ctrl+O)"
                >
                  <Upload size={14} /> Abrir archivo
                </button>

                {ROOT_CSV_TEMPLATES.length > 0 && (
                  <div className="mr-template-list">
                    {ROOT_CSV_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        className="mr-btn"
                        onClick={() => loadCsvIntoSession(tpl.name, tpl.content)}
                      >
                        <FileSpreadsheet size={13} /> Cargar plantilla: {tpl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={tableWrapRef}
              className="mr-table-wrap"
              tabIndex={0}
              onKeyDown={handleTableKeyDown}
            >
              <table className="mr-table">
                <thead>
                  <tr>
                    <th className="mr-cell-rownum">#</th>
                    {columns.map((col, colIdx) => {
                      const isColActive = col === activeColumn;
                      const isFullColSelected = isColActive && selectionMode === "column";
                      const isSorted = sortState?.column === col;
                      const sortDir = isSorted ? sortState.dir : null;

                      return (
                        <th
                          key={col}
                          className={
                            isFullColSelected
                              ? "col-full-selected"
                              : isColActive
                                ? "active-col"
                                : ""
                          }
                          title={`Clic para seleccionar toda la columna "${col}"`}
                          onClick={() => {
                            updateActiveSession((s) => ({
                              ...s,
                              selectedColumn: col,
                              selectionMode: "column",
                              facetFilter: null,
                              selectedCell: {
                                visibleIdx: s.selectedCell?.visibleIdx ?? 0,
                                colIdx,
                              },
                            }));
                          }}
                        >
                          <div className="mr-th-inner">
                            <span>
                              {col} {isFullColSelected ? "✓" : ""}
                            </span>
                            <button
                              type="button"
                              className={`mr-sort-btn ${isSorted ? "active" : ""}`}
                              title={`Ordenar "${col}" (menor a mayor / alfabético)`}
                              onClick={(e) => handleToggleColumnSort(col, e)}
                            >
                              {sortDir === "asc" ? (
                                <ArrowUp size={12} />
                              ) : sortDir === "desc" ? (
                                <ArrowDown size={12} />
                              ) : (
                                <ArrowUpDown size={12} />
                              )}
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map(({ origIdx, data }, pageIdx) => {
                    const visibleIdx = pageOffset + pageIdx;
                    const isRowSelected =
                      selectionMode === "cell" && selectedCell?.visibleIdx === visibleIdx;
                    return (
                      <tr key={origIdx} className={isRowSelected ? "mr-row-selected" : ""}>
                        <td className="mr-cell-rownum">{origIdx + 1}</td>
                        {columns.map((col, colIdx) => {
                          const val = data[col] ?? "";
                          const isEmpty = val.trim() === "";
                          const hasExtraSpace =
                            !isEmpty && (val !== val.trim() || /\s{2,}/.test(val));
                          const isEditing =
                            editingCell?.origIdx === origIdx && editingCell?.col === col;
                          const isCellSelected =
                            selectionMode === "cell" &&
                            isRowSelected &&
                            selectedCell?.colIdx === colIdx;
                          const isColSelected =
                            selectionMode === "column" && col === activeColumn;

                          return (
                            <td
                              key={col}
                              data-cell={`${visibleIdx}-${colIdx}`}
                              className={[
                                isEmpty ? "mr-cell-empty" : hasExtraSpace ? "mr-cell-space" : "",
                                isColSelected ? "mr-col-selected" : "",
                                isCellSelected ? "mr-cell-selected" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => {
                                updateActiveSession((s) => ({
                                  ...s,
                                  selectionMode: "cell",
                                  selectedCell: { visibleIdx, colIdx },
                                  selectedColumn: col,
                                }));
                                tableWrapRef.current?.focus();
                              }}
                              onDoubleClick={() => {
                                updateActiveSession((s) => ({
                                  ...s,
                                  selectionMode: "cell",
                                  selectedCell: { visibleIdx, colIdx },
                                }));
                                setEditingCell({ origIdx, col });
                                setEditDraft(val);
                              }}
                            >
                              {isEditing ? (
                                <input
                                  className="mr-cell-input"
                                  autoFocus
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onBlur={handleCommitCellEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCommitCellEdit();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                />
                              ) : isEmpty ? (
                                "∅ vacío"
                              ) : (
                                val
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* ZONE 3: History Accordions, Trash & JSON Recipe */}
        <aside className="mr-zone mr-zone-right">
          <div className="mr-zone-header">
            <span>
              <History size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Historial y Papelera
            </span>
          </div>

          <div className="mr-scroll">
            <div className="mr-history-undo-bar">
              <button
                className="mr-btn"
                onClick={handleUndo}
                disabled={steps.length === 0}
                title="Deshacer último paso (Ctrl+Z)"
              >
                <Undo2 size={14} /> Deshacer
              </button>
              <button
                className="mr-btn"
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                title="Rehacer paso (Ctrl+Shift+Z)"
              >
                <Redo2 size={14} /> Rehacer
              </button>
            </div>

            <div className="mr-tabs-3">
              <button
                className={`mr-tab ${rightTab === "history" ? "active" : ""}`}
                onClick={() => setRightTab("history")}
              >
                Pasos ({steps.length})
              </button>
              <button
                className={`mr-tab ${rightTab === "trash" ? "active" : ""}`}
                onClick={() => setRightTab("trash")}
              >
                Papelera ({trash.length + hiddenColumns.length})
              </button>
              <button
                className={`mr-tab ${rightTab === "recipe" ? "active" : ""}`}
                onClick={() => setRightTab("recipe")}
              >
                Receta
              </button>
            </div>

            {rightTab === "history" &&
              (stepAccordionGroups.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                  Aún no aplicas cambios en esta tabla. Los pasos se agruparán automáticamente por
                  columna y tarea.
                </div>
              ) : (
                stepAccordionGroups.map((group) => {
                  const isCollapsed = Boolean(collapsedGroups[group.key]);
                  const allEnabled = group.steps.every((s) => s.step.enabled);
                  const groupIds = group.steps.map((s) => s.step.id);

                  return (
                    <div key={group.key} className="mr-acc-group">
                      <div
                        className="mr-acc-header"
                        onClick={() =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [group.key]: !prev[group.key],
                          }))
                        }
                      >
                        <div className="mr-acc-title">
                          <input
                            type="checkbox"
                            checked={allEnabled}
                            title="Activar o desactivar todos los pasos de esta tarea"
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => handleToggleGroupSteps(groupIds, !allEnabled)}
                          />
                          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {group.title}
                          </span>
                        </div>
                        <div className="mr-facet-actions">
                          <span className="mr-acc-badge">{group.steps.length}</span>
                          <button
                            className="mr-icon-btn"
                            title="Eliminar todos los pasos de este grupo"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteGroupSteps(groupIds);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div className="mr-acc-body">
                          {group.steps.map(({ step, globalIndex }) => (
                            <div
                              key={step.id}
                              className={`mr-step-card ${step.enabled ? "" : "disabled"}`}
                            >
                              <div className="mr-step-row">
                                <label className="mr-step-check">
                                  <input
                                    type="checkbox"
                                    checked={step.enabled}
                                    onChange={() => handleToggleStep(step.id)}
                                    title="Activar o desactivar este paso en tiempo real"
                                  />
                                  <div>
                                    <div className="mr-step-num">Paso {globalIndex + 1}</div>
                                    <div className="mr-step-label">{step.label}</div>
                                  </div>
                                </label>
                                <button
                                  className="mr-icon-btn"
                                  title="Eliminar este paso del historial"
                                  onClick={() => handleDeleteStep(step.id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ))}

            {rightTab === "trash" &&
              (trash.length === 0 && hiddenColumns.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                  No hay filas ni columnas ocultas en esta tabla.
                </div>
              ) : (
                <div>
                  {hiddenColumns.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#93c5fd",
                          marginBottom: 6,
                          textTransform: "uppercase",
                        }}
                      >
                        Columnas ocultas ({hiddenColumns.length})
                      </div>
                      {hiddenColumns.map((col) => (
                        <div key={col} className="mr-trash-card">
                          <div className="mr-trash-meta">
                            <strong>Columna: {col}</strong>
                            <span>Datos preservados en memoria</span>
                          </div>
                          <button
                            className="mr-op-btn"
                            style={{ width: "100%" }}
                            onClick={() =>
                              pushStep("restore_column", col, `Restaurar columna "${col}"`)
                            }
                          >
                            ↩ Volver a mostrar columna "{col}"
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {trash.length > 0 && (
                    <>
                      <button
                        className="mr-btn"
                        style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}
                        onClick={() =>
                          handleRestoreRows(
                            trash.map((t) => t.origIdx),
                            `Restaurar ${trash.length} filas de la papelera`
                          )
                        }
                      >
                        <RotateCcw size={13} /> Restaurar todas las filas ({trash.length})
                      </button>

                      {trash.map((entry) => (
                        <div key={entry.origIdx} className="mr-trash-card">
                          <div className="mr-trash-meta">
                            <strong>Fila #{entry.origIdx + 1}</strong>
                            <span>{entry.reason}</span>
                          </div>
                          <div className="mr-trash-preview">
                            {columns
                              .slice(0, 4)
                              .map((c) => `${c}: ${entry.data[c] || "∅"}`)
                              .join(" · ")}
                          </div>
                          <button
                            className="mr-op-btn"
                            style={{ width: "100%" }}
                            onClick={() =>
                              handleRestoreRows(
                                [entry.origIdx],
                                `Restaurar fila #${entry.origIdx + 1}`
                              )
                            }
                          >
                            ↩ Restaurar fila #{entry.origIdx + 1}
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}

            {rightTab === "recipe" && <pre className="mr-recipe-pre">{recipeJson}</pre>}
          </div>
        </aside>
      </div>
    </div>
  );
}
