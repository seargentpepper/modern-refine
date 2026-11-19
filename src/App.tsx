import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  CopyMinus,
  Database,
  Download,
  ExternalLink,
  EyeOff,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderInput,
  FolderOpen,
  GitCompare,
  Globe,
  GraduationCap,
  Grid3X3,
  History,
  Info,
  Keyboard,
  Merge,
  Redo2,
  Replace,
  RotateCcw,
  Rows3,
  Save,
  Scissors,
  Search,
  Send,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  FluentPanelLeftIcon,
  FluentPanelRightIcon,
  FluentRecipeIcon,
} from "./assets/icons/FluentIcons";
import { ActionModals, type ActiveActionModal } from "./components/ActionModals";
import { DuckDbModal } from "./components/DuckDbModal";
import { GetDataWizard, type GetDataInitialTarget } from "./components/GetDataWizard";
import { Icon } from "./components/Icon";
import { ColumnQualityBar, SmartFacetsPanel } from "./components/SmartFacetsPanel";
import { ROOT_CSV_TEMPLATES } from "./data/csvTemplates";
import {
  buildColumnFrequencyMap,
  classifyCellQuality,
  computeClusters,
  computeColumnDiagnostic,
  computeColumnQualityProfile,
  computeDateTimeline,
  computeDuplicateSummary,
  computeFacets,
  computeNumericRangeProfile,
  inferCellType,
  isErrorCellValue,
  isLikelyDateColumn,
  parseCalendarDate,
  parseCsvText,
  parseNumericValue,
  replayRecipeWithTrash,
  serializeCsv,
} from "./lib/refineEngine";
import {
  exportParquetWithDialogBridge,
  saveFileWithDialogBridge,
} from "./lib/tauriBridge";
import { type FormulaPreviewRow, previewFormulaOnRows } from "./lib/formula/evaluator";
import { buildLlmPromptForTable, parseFormulaOrLlmJson } from "./lib/formula/llmHelper";
import type {
  CellInferredType,
  ClusterMethod,
  ColumnDataType,
  DataRow,
  DateTargetFormat,
  FileIngestionMeta,
  QualityFilterKind,
  RefineStep,
  SourceDescriptor,
  TableSession,
  TransformKind,
} from "./types/refine";

const TASK_GROUP_MAP: Record<TransformKind, { key: string; title: string }> = {
  trim: { key: "task_text", title: "Limpieza de texto" },
  clean_deep: { key: "task_text", title: "Limpieza de texto" },
  title_case: { key: "task_text", title: "Limpieza de texto" },
  upper_case: { key: "task_text", title: "Limpieza de texto" },
  lower_case: { key: "task_text", title: "Limpieza de texto" },
  strip_accents: { key: "task_text", title: "Limpieza de texto" },
  extract_text: { key: "task_text", title: "Limpieza de texto" },
  extract_numbers: { key: "task_numeric", title: "Números y códigos postales" },
  pad_postal_code: { key: "task_numeric", title: "Números y códigos postales" },
  standardize_dates: { key: "task_dates", title: "Homologación de fechas" },
  cast_column_type: { key: "task_types", title: "Tipado de columnas" },
  fill_empty_default: { key: "task_fill", title: "Relleno de vacíos" },
  fill_down: { key: "task_fill", title: "Relleno de vacíos" },
  fill_up: { key: "task_fill", title: "Relleno de vacíos" },
  merge_cluster: { key: "task_values", title: "Fusión y edición de valores" },
  rename_facet: { key: "task_values", title: "Fusión y edición de valores" },
  replace_value: { key: "task_values", title: "Fusión y edición de valores" },
  replace_errors: { key: "task_errors", title: "Manejo de errores" },
  remove_error_rows: { key: "task_errors", title: "Manejo de errores" },
  edit_cell: { key: "task_values", title: "Fusión y edición de valores" },
  duplicate_column: { key: "task_structure", title: "Estructura y división" },
  rename_column: { key: "task_structure", title: "Estructura y división" },
  hide_column: { key: "task_structure", title: "Estructura y división" },
  restore_column: { key: "task_structure", title: "Estructura y división" },
  split_keep_left: { key: "task_structure", title: "Estructura y división" },
  split_keep_right: { key: "task_structure", title: "Estructura y división" },
  split_into_two_columns: { key: "task_structure", title: "Estructura y división" },
  split_column_flexible: { key: "task_structure", title: "Estructura y división" },
  merge_columns: { key: "task_structure", title: "Estructura y división" },
  split_mexican_name: { key: "task_structure", title: "Estructura y división" },
  promote_headers: { key: "task_structure", title: "Estructura y división" },
  unpivot_columns: { key: "task_structure", title: "Estructura y división" },
  remove_duplicates: { key: "task_rows", title: "Depuración de filas" },
  delete_row: { key: "task_rows", title: "Depuración de filas" },
  delete_empty_rows: { key: "task_rows", title: "Depuración de filas" },
  restore_rows: { key: "task_rows", title: "Depuración de filas" },
  add_row: { key: "task_rows", title: "Depuración de filas" },
  add_column: { key: "task_structure", title: "Estructura y división" },
  computed_column: { key: "task_formula", title: "Fórmulas y Cálculos Personalizados" },
  formula: { key: "task_formula", title: "Fórmulas y Cálculos Personalizados" },
};

const EMPTY_FACET_FILTERS = {
  facetFilter: null as string | null,
  qualityFilter: null as QualityFilterKind | null,
  typeFilter: null as CellInferredType | null,
  duplicateFilter: "all" as "all" | "duplicates" | "unique",
  numericRangeFilter: null as { min: number; max: number } | null,
  timelinePeriodFilter: null as string | null,
  filterAlias: "",
};

const BLOG_URL = ""; // Pendiente de hipervínculo del usuario

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

  // Menús desplegables (Recetas / Exportar / Estructura de Columna / Tipo / Obtener datos)
  const [openMenu, setOpenMenu] = useState<
    "recipes" | "export" | "col_ops" | "type_cast" | "errors" | "get_data" | null
  >(null);
  const [activeActionModal, setActiveActionModal] = useState<ActiveActionModal>(null);
  const [getDataTarget, setGetDataTarget] = useState<GetDataInitialTarget | null>(null);
  const [showDuckDbModal, setShowDuckDbModal] = useState(false);
  const [isRenamingCol, setIsRenamingCol] = useState(false);
  const [renameColDraft, setRenameColDraft] = useState("");

  // Acordeones colapsados en el Historial
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Paginación virtualizada para tablas masivas (>100 filas)
  const [pageBySession, setPageBySession] = useState<Record<string, number>>({});
  const PAGE_SIZE = 100;

  const [leftTab, setLeftTab] = useState<"facets" | "clusters">("clusters");
  const [rightTab, setRightTab] = useState<"history" | "trash" | "recipe">("history");

  // Estado del shell Office-like (DashCraft) — 3 zonas originales colapsables
  const [activeRibbonTab, setActiveRibbonTab] = useState<
    "inicio" | "vista" | "ayuda"
  >("inicio");
  const [showFileBackstage, setShowFileBackstage] = useState(false);
  const [backstageSection, setBackstageSection] = useState<"open" | "recipes" | "export" | "about">(
    "open"
  );
  const [showFilterHelp, setShowFilterHelp] = useState(false);
  const [showFormulaBar, setShowFormulaBar] = useState(false);
  const [formulaInput, setFormulaInput] = useState("");
  const [formulaMode, setFormulaMode] = useState<"replace" | "new_column">("replace");
  const [formulaNewColName, setFormulaNewColName] = useState("");
  const [formulaPreviewState, setFormulaPreviewState] = useState<
    | { status: "ok"; expression: string; targetCol: string; mode: "replace" | "new_column"; rows: FormulaPreviewRow[] }
    | { status: "error"; message: string }
    | null
  >(null);
  const [llmPromptCopied, setLlmPromptCopied] = useState(false);
  const [savedFormulas, setSavedFormulas] = useState<
    Array<{ id: string; label: string; expression: string; enabled: boolean }>
  >([
    {
      id: "fx_mx_phone",
      label: "Tel +52 (10 díg.)",
      expression: "NORMALIZE_PHONE_MX([COL])",
      enabled: true,
    },
    {
      id: "fx_clean_upper",
      label: "MAYÚS sin acentos",
      expression: "UPPER(REMOVE_ACCENTS([COL]))",
      enabled: true,
    },
  ]);
  const [showColInspector, setShowColInspector] = useState(false);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [gridFilterDraft, setGridFilterDraft] = useState("");
  const [appliedGridFilter, setAppliedGridFilter] = useState("");
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

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
  const globalSearchRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

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
  const qualityFilter = activeSession?.qualityFilter ?? null;
  const typeFilter = activeSession?.typeFilter ?? null;
  const duplicateFilter = activeSession?.duplicateFilter ?? "all";
  const numericRangeFilter = activeSession?.numericRangeFilter ?? null;
  const timelinePeriodFilter = activeSession?.timelinePeriodFilter ?? null;
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

  const qualityProfile = useMemo(
    () => (activeColumn ? computeColumnQualityProfile(currentDataRows, activeColumn) : null),
    [currentDataRows, activeColumn]
  );

  const duplicateSummary = useMemo(
    () => (activeColumn ? computeDuplicateSummary(currentDataRows, activeColumn, columns) : null),
    [currentDataRows, activeColumn, columns]
  );

  const colFreqMap = useMemo(
    () => (activeColumn ? buildColumnFrequencyMap(currentDataRows, activeColumn) : new Map<string, number>()),
    [currentDataRows, activeColumn]
  );

  const numericRangeProfile = useMemo(
    () => (activeColumn ? computeNumericRangeProfile(currentDataRows, activeColumn, 8) : null),
    [currentDataRows, activeColumn]
  );

  const timelineBuckets = useMemo(
    () => (activeColumn ? computeDateTimeline(currentDataRows, activeColumn) : []),
    [currentDataRows, activeColumn]
  );

  const colStats = useMemo(() => {
    if (!activeColumn || currentDataRows.length === 0) return null;
    const vals = currentDataRows.map((r) => String(r[activeColumn] ?? "").trim()).filter(Boolean);
    const nums = vals.map(parseSortableNumber).filter((n): n is number => n !== null);
    const isNumeric = vals.length > 0 && nums.length >= Math.ceil(vals.length * 0.8);
    let min: number | null = null;
    let max: number | null = null;
    if (isNumeric && nums.length > 0) {
      min = Math.min(...nums);
      max = Math.max(...nums);
    }
    return { isNumeric, min, max };
  }, [currentDataRows, activeColumn]);

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

  const clearAllFacetFilters = useCallback(() => {
    updateActiveSession((s) => ({
      ...s,
      ...EMPTY_FACET_FILTERS,
    }));
  }, [updateActiveSession]);

  const visibleRows = useMemo(() => {
    const isPostalCol = /cp|postal/i.test(activeColumn);
    const dominantType = qualityProfile?.dominantType ?? "text";

    const byFacets = !activeColumn
      ? activeRows
      : activeRows.filter((item) => {
          const val = item.data[activeColumn] ?? "";
          if (facetFilter !== null && val !== facetFilter) return false;
          if (
            qualityFilter !== null &&
            classifyCellQuality(val, { isDateCol, isPostalCol, dominantType }) !== qualityFilter
          ) {
            return false;
          }
          if (typeFilter !== null && inferCellType(val, isDateCol) !== typeFilter) {
            return false;
          }
          if (duplicateFilter !== "all") {
            if (val.trim() === "") return false;
            const count = colFreqMap.get(val) ?? 0;
            if (duplicateFilter === "duplicates" && count <= 1) return false;
            if (duplicateFilter === "unique" && count !== 1) return false;
          }
          if (numericRangeFilter !== null) {
            const numVal = parseNumericValue(val);
            if (
              numVal === null ||
              numVal < numericRangeFilter.min ||
              numVal > numericRangeFilter.max
            ) {
              return false;
            }
          }
          if (timelinePeriodFilter !== null) {
            if (!val.trim()) return false;
            const parsed = parseCalendarDate(val, true);
            const period = parsed
              ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}`
              : "Inválida / Sin fecha";
            if (period !== timelinePeriodFilter) return false;
          }
          return true;
        });

    const q = appliedGridFilter.trim().toLowerCase();
    const filtered = q
      ? byFacets.filter((item) =>
          columns.some((c) => String(item.data[c] ?? "").toLowerCase().includes(q))
        )
      : byFacets;

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
  }, [
    activeRows,
    facetFilter,
    qualityFilter,
    typeFilter,
    duplicateFilter,
    numericRangeFilter,
    timelinePeriodFilter,
    qualityProfile,
    colFreqMap,
    isDateCol,
    appliedGridFilter,
    activeColumn,
    sortState,
    columns,
    currentDataRows,
  ]);

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

  // Agrupación del Historial en Acordeones por Tarea
  const stepAccordionGroups = useMemo<StepAccordionGroup[]>(() => {
    const groupsMap = new Map<string, StepAccordionGroup>();
    steps.forEach((step, idx) => {
      const { key, title } = TASK_GROUP_MAP[step.kind] ?? {
        key: `task_${step.kind}`,
        title: `Tarea: ${step.kind}`,
      };
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
          ...(activeSession?.sourceDescriptor ? { source: activeSession.sourceDescriptor } : {}),
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
    [cleanTableName, fileName, ingestionMeta, activeSession?.sourceDescriptor, steps]
  );

  const openOrActivateSession = (
    name: string,
    cols: string[],
    rows: DataRow[],
    meta: FileIngestionMeta,
    wb?: XLSX.WorkBook,
    sourceDescriptor?: SourceDescriptor | null
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
      sourceDescriptor: sourceDescriptor ?? null,
      steps: [],
      redoStack: [],
      selectedColumn: cols[0],
      selectionMode: "column",
      sortState: null,
      ...EMPTY_FACET_FILTERS,
      selectedCell: rows.length > 0 ? { visibleIdx: 0, colIdx: 0 } : null,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(id);
    setEditingCell(null);
    setIsRenamingCol(false);
    setClusterMethodFilter("ALL");
  };

  const triggerFilePicker = (acceptFilter?: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = acceptFilter || ".csv,.tsv,.txt,.xlsx,.xls,.ods,.json";
    input.click();
  };

  const handleCreateBlankTable = (tableName: string, cols: string[], rowCount: number) => {
    const rows: DataRow[] = Array.from({ length: rowCount }, () => {
      const r: DataRow = {};
      for (const c of cols) r[c] = "";
      return r;
    });
    openOrActivateSession(`${tableName}.csv`, cols, rows, {
      delimiterLabel: "Tabla manual",
      dedupedHeaders: 0,
    });
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
        ...EMPTY_FACET_FILTERS,
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

  const handleExportParquet = useCallback(async () => {
    if (!hasData) return;
    setOpenMenu(null);
    try {
      await exportParquetWithDialogBridge(
        `${cleanTableName}_limpio`,
        cleanTableName,
        columns,
        visibleRows.map((r) => r.data)
      );
    } catch (err) {
      setShowDuckDbModal(true);
      console.warn("Parquet nativo:", err);
    }
  }, [hasData, cleanTableName, columns, visibleRows]);

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
        ...EMPTY_FACET_FILTERS,
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
        ...EMPTY_FACET_FILTERS,
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

      if (e.key === "Escape") {
        if (showDuckDbModal) {
          setShowDuckDbModal(false);
          return;
        }
        if (getDataTarget) {
          setGetDataTarget(null);
          return;
        }
        if (activeActionModal) {
          setActiveActionModal(null);
          return;
        }
        if (showFileBackstage) {
          setShowFileBackstage(false);
          return;
        }
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
          return;
        }
        if (openMenu) {
          setOpenMenu(null);
          return;
        }
      }

      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setShowShortcutsModal((v) => !v);
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        globalSearchRef.current?.focus();
        globalSearchRef.current?.select();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || isInput) return;
      const key = e.key.toLowerCase();

      if (e.altKey) {
        if (key === "l") {
          e.preventDefault();
          setLeftPaneCollapsed((v) => !v);
          return;
        }
        if (key === "p") {
          e.preventDefault();
          setRightPaneCollapsed((v) => !v);
          return;
        }
      }

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

      {/* 1. TITLEBAR + QUICK ACCESS TOOLBAR (DashCraft Style) */}
      <header className="mr-titlebar">
        <div className="mr-qat">
          <span className="mr-app-icon-btn" title="ModernRefine — Estación ETL Pre-BI">
            <img src="/mR_harmonia_cutout.png" alt="ModernRefine" className="mr-logo-img" />
          </span>
          <button
            className="mr-qat-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Abrir archivo(s) CSV, TSV, Excel, ODS o JSON (Ctrl+O)"
          >
            <Icon icon={Upload} size={14} />
          </button>
          <button
            className="mr-qat-btn"
            onClick={handleExportXlsx}
            disabled={!hasData}
            title="Exportar a Excel (.xlsx) (Ctrl+Shift+E)"
          >
            <Icon icon={Download} size={14} />
          </button>
        </div>

        <div className="mr-titlebar-center">
          <span className="mr-doc-title" title={hasData ? fileName : "Sin archivo cargado"}>
            {hasData ? `${fileName} - ModernRefine` : "ModernRefine"}
          </span>
          <div className="mr-global-search-wrap">
            <Search size={13} className="mr-global-search-icon" />
            <input
              ref={globalSearchRef}
              type="text"
              className="mr-global-search"
              placeholder="Buscar columna o comando..."
              value={globalSearch}
              onChange={(e) => {
                const q = e.target.value;
                setGlobalSearch(q);
                const matchCol = columns.find((c) => c.toLowerCase().includes(q.trim().toLowerCase()));
                if (q.trim() && matchCol) {
                  updateActiveSession((s) => ({ ...s, selectedColumn: matchCol }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setGlobalSearch("");
                  tableWrapRef.current?.focus();
                }
              }}
            />
            <span className="mr-kbd-hint">Ctrl+K</span>
          </div>
        </div>

        <div className="mr-titlebar-right">
          {workbookRef && ingestionMeta?.sheets && ingestionMeta.sheets.length > 1 && (
            <select
              className="mr-date-select"
              style={{ width: 136, height: 24 }}
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
          <span className="mr-brand-pill">Estación ETL</span>
        </div>
      </header>

      {/* 2. RIBBON (Tabs + Body) */}
      <nav className="mr-ribbon" aria-label="Cinta de opciones">
        <div className="mr-ribbon-tabs" role="tablist">
          <button
            type="button"
            className={`mr-ribbon-tab ${showFileBackstage ? "active" : ""}`}
            onClick={() => {
              setBackstageSection("open");
              setShowFileBackstage(true);
            }}
          >
            Archivo
          </button>
          {(
            [
              ["inicio", "Inicio"],
              ["vista", "Vista"],
              ["ayuda", "Ayuda"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={!showFileBackstage && activeRibbonTab === id}
              className={`mr-ribbon-tab ${!showFileBackstage && activeRibbonTab === id ? "active" : ""}`}
              onClick={() => {
                setShowFileBackstage(false);
                setActiveRibbonTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mr-ribbon-body">
          {activeRibbonTab === "inicio" && (
            <>
              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className="mr-ribbon-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Abrir uno o varios archivos: CSV, TSV, Excel, ODS o JSON (Ctrl+O)"
                  >
                    <Icon icon={Upload} size={20} />
                    <span>Abrir</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData}
                    onClick={() => handleCloseSession()}
                    title="Cerrar pestaña de tabla activa (Alt+W)"
                  >
                    <Icon icon={X} size={20} />
                    <span>Cerrar</span>
                  </button>

                  {/* Dropdown unificado de Recetas (.refine.json) */}
                  <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="mr-ribbon-btn"
                      disabled={!hasData}
                      onClick={() => setOpenMenu(openMenu === "recipes" ? null : "recipes")}
                      title="Cargar (Ctrl+Shift+O) o Guardar (Ctrl+S) recetas (.refine.json)"
                    >
                      <Icon icon={FluentRecipeIcon} size={20} />
                      <span>Recetas ▾</span>
                    </button>
                    {openMenu === "recipes" && (
                      <div className="mr-dropdown-menu">
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            recipeInputRef.current?.click();
                          }}
                          title="Cargar archivo de receta previo en la tabla activa (Ctrl+Shift+O)"
                        >
                          <Icon icon={FolderInput} size={14} />
                          <span>Cargar Receta (.json)</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            handleSaveRecipe();
                          }}
                          title={`Guardar receta para "${cleanTableName}" (Ctrl+S)`}
                        >
                          <Icon icon={Download} size={14} />
                          <span>Guardar "{cleanTableName}.refine.json"</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Dropdown unificado de Exportar (Excel XLSX / CSV) */}
                  <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="mr-ribbon-btn active"
                      disabled={!hasData}
                      onClick={() => setOpenMenu(openMenu === "export" ? null : "export")}
                      title="Exportar tabla activa en Excel (Ctrl+Shift+E) o CSV (Ctrl+E)"
                    >
                      <Icon icon={Download} size={20} />
                      <span>Exportar ▾</span>
                    </button>
                    {openMenu === "export" && (
                      <div className="mr-dropdown-menu">
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            handleExportXlsx();
                          }}
                          title="Exportar como libro Excel .xlsx (Ctrl+Shift+E)"
                        >
                          <Icon icon={FileSpreadsheet} size={14} />
                          <span>Exportar en Excel (.xlsx)</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            handleExportCsv();
                          }}
                          title="Exportar como archivo .csv (Ctrl+E)"
                        >
                          <Icon icon={Download} size={14} />
                          <span>Exportar en CSV (.csv)</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            handleExportParquet();
                          }}
                          title="Exportar como Apache Parquet vía DuckDB Nativo (Desktop)"
                        >
                          <Icon icon={Database} size={14} />
                          <span>Exportar en Parquet (.parquet)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mr-ribbon-group-label">Archivo, Recetas y Exportar</div>
              </div>



              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || !activeColumn}
                    onClick={() => setActiveActionModal("replace")}
                    title={`Buscar y reemplazar valores en "${activeColumn || "columna"}"`}
                  >
                    <Icon icon={Replace} size={20} />
                    <span>Reemplazar</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || !activeColumn}
                    onClick={() => setActiveActionModal("dedupe")}
                    title="Quitar filas duplicadas por columna clave o por fila completa"
                  >
                    <Icon icon={CopyMinus} size={20} />
                    <span>Duplicados</span>
                  </button>

                  {/* Dropdown Tipo de Dato */}
                  <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="mr-ribbon-btn"
                      disabled={!hasData || !activeColumn}
                      onClick={() => setOpenMenu(openMenu === "type_cast" ? null : "type_cast")}
                      title="Convertir el tipo de dato de la columna activa marcando errores"
                    >
                      <Icon icon={Type} size={20} />
                      <span>Tipo ▾</span>
                    </button>
                    {openMenu === "type_cast" && (
                      <div className="mr-dropdown-menu">
                        {(
                          [
                            ["text", "Texto"],
                            ["integer", "Número Entero"],
                            ["decimal", "Número Decimal"],
                            ["date", "Fecha (ISO)"],
                            ["boolean", "Booleano (TRUE/FALSE)"],
                          ] as Array<[ColumnDataType, string]>
                        ).map(([tKind, tLabel]) => (
                          <button
                            key={tKind}
                            className="mr-dropdown-item"
                            onClick={() => {
                              setOpenMenu(null);
                              pushStep(
                                "cast_column_type",
                                activeColumn,
                                `Tipar "${activeColumn}" como ${tLabel}`,
                                { targetType: tKind, onError: "mark" }
                              );
                            }}
                          >
                            <span>{tLabel}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dropdown Manejo de Errores */}
                  <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="mr-ribbon-btn"
                      disabled={!hasData || !activeColumn}
                      onClick={() => setOpenMenu(openMenu === "errors" ? null : "errors")}
                      title="Reemplazar o eliminar filas con errores (#ERROR!, #N/A, etc.)"
                    >
                      <Icon icon={AlertTriangle} size={20} />
                      <span>Errores ▾</span>
                    </button>
                    {openMenu === "errors" && (
                      <div className="mr-dropdown-menu">
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            pushStep(
                              "replace_errors",
                              activeColumn,
                              `Reemplazar errores por vacío (${activeColumn})`,
                              { replacement: "" }
                            );
                          }}
                        >
                          <span>Reemplazar errores por vacío</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            pushStep(
                              "replace_errors",
                              activeColumn,
                              `Reemplazar errores por "0" (${activeColumn})`,
                              { replacement: "0" }
                            );
                          }}
                        >
                          <span>Reemplazar errores por "0"</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          style={{ color: "var(--mr-danger)" }}
                          onClick={() => {
                            setOpenMenu(null);
                            pushStep(
                              "remove_error_rows",
                              activeColumn,
                              `Eliminar filas con errores en "${activeColumn}"`
                            );
                          }}
                        >
                          <span>Quitar filas con errores</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mr-ribbon-group-label">Limpieza y Datos</div>
              </div>

              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || !activeColumn}
                    onClick={() => setActiveActionModal("split")}
                    title="Dividir columna por delimitador libre o por número de caracteres"
                  >
                    <Icon icon={Scissors} size={20} />
                    <span>Dividir</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || columns.length < 2}
                    onClick={() => setActiveActionModal("merge")}
                    title="Combinar 2 o más columnas con separador personalizado"
                  >
                    <Icon icon={Merge} size={20} />
                    <span>Combinar</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || !activeColumn}
                    onClick={() => setActiveActionModal("extract")}
                    title="Extraer texto antes, después o entre delimitadores sin fórmulas"
                  >
                    <Icon icon={Rows3} size={20} />
                    <span>Extraer</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || columns.length < 2}
                    onClick={() => setActiveActionModal("unpivot")}
                    title="Anular dinamización (Unpivot): convertir columnas en filas Atributo/Valor"
                  >
                    <Icon icon={Table2} size={20} />
                    <span>Unpivot</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData || activeRows.length < 2}
                    onClick={() =>
                      pushStep(
                        "promote_headers",
                        activeColumn || columns[0],
                        "Promover 1ª fila como encabezados"
                      )
                    }
                    title="Usar la primera fila activa como nombres de columna (Excel sucio)"
                  >
                    <Icon icon={ArrowUp} size={20} />
                    <span>1ª Fila Encab.</span>
                  </button>
                </div>
                <div className="mr-ribbon-group-label">Columnas y Forma</div>
              </div>

              {ROOT_CSV_TEMPLATES.length > 0 && (
                <div className="mr-ribbon-group">
                  <div className="mr-ribbon-group-items">
                    <div className="mr-ribbon-inline-control">
                      <span className="mr-ribbon-inline-label">Plantilla rápida</span>
                      <select
                        className="mr-date-select"
                        style={{ width: 175 }}
                        value=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          const tpl = ROOT_CSV_TEMPLATES.find((t) => t.name === val);
                          if (tpl) loadCsvIntoSession(tpl.name, tpl.content);
                        }}
                      >
                        <option value="">+ Abrir Plantilla ({ROOT_CSV_TEMPLATES.length})</option>
                        {ROOT_CSV_TEMPLATES.map((tpl) => (
                          <option key={tpl.name} value={tpl.name}>
                            {tpl.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mr-ribbon-group-label">Plantillas</div>
                </div>
              )}

              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  {/* Menú rápido estilo Power BI: Orígenes de datos comunes (pbi_01) */}
                  <div className="mr-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="mr-ribbon-btn"
                      onClick={() => setOpenMenu(openMenu === "get_data" ? null : "get_data")}
                      title="Obtener datos desde Excel, CSV, Web, Wikipedia o SQL"
                    >
                      <Icon icon={Database} size={20} />
                      <span>Obtener datos ▾</span>
                    </button>
                    {openMenu === "get_data" && (
                      <div className="mr-dropdown-menu" style={{ minWidth: 230 }}>
                        <div className="mr-dropdown-header">Orígenes de datos comunes</div>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            triggerFilePicker(".xlsx,.xls,.ods");
                            setOpenMenu(null);
                          }}
                        >
                          <FileSpreadsheet size={14} style={{ color: "#107c41" }} />
                          <span>Libro de Excel (.xlsx / .ods)</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            triggerFilePicker(".csv,.tsv,.txt");
                            setOpenMenu(null);
                          }}
                        >
                          <FileText size={14} style={{ color: "#5c6b73" }} />
                          <span>Texto o CSV / TSV</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            triggerFilePicker(".json");
                            setOpenMenu(null);
                          }}
                        >
                          <FileJson size={14} style={{ color: "#ca5010" }} />
                          <span>JSON local</span>
                        </button>
                        <div className="mr-menu-divider" />
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            setGetDataTarget("sqlserver");
                          }}
                        >
                          <Database size={14} style={{ color: "#b45309" }} />
                          <span>Base de datos SQL</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            setGetDataTarget("web_json");
                          }}
                        >
                          <Globe size={14} style={{ color: "#0066cc" }} />
                          <span>Web (API JSON / CSV)</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            setGetDataTarget("wikipedia");
                          }}
                        >
                          <BookOpen size={14} style={{ color: "var(--mr-accent)" }} />
                          <span>Tablas de Wikipedia</span>
                        </button>
                        <div className="mr-menu-divider" />
                        <button
                          className="mr-dropdown-item"
                          onClick={() => {
                            setOpenMenu(null);
                            setGetDataTarget("catalog");
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>Más...</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="mr-ribbon-btn"
                    disabled={!hasData}
                    onClick={() => setShowDuckDbModal(true)}
                    title="Abrir motor DuckDB Nativo (SQL, Group By, Fórmulas de Ventana y Parquet)"
                  >
                    <Icon icon={Database} size={20} />
                    <span>DuckDB Nativo</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled
                    title="Enviar tabla limpia directo a Analyticraft (próximamente)"
                  >
                    <Icon icon={Send} size={20} />
                    <span>Analyticraft</span>
                  </button>
                </div>
                <div className="mr-ribbon-group-label">Orígenes y Ecosistema</div>
              </div>
            </>
          )}

          {activeRibbonTab === "vista" && (
            <>
              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className={`mr-ribbon-btn ${!leftPaneCollapsed ? "active" : ""}`}
                    onClick={() => setLeftPaneCollapsed((v) => !v)}
                    title="Mostrar / colapsar panel Facetas y Clústeres (Ctrl+Alt+L)"
                  >
                    <Icon icon={FluentPanelLeftIcon} size={20} />
                    <span>Facetas</span>
                  </button>
                  <button
                    className={`mr-ribbon-btn ${!rightPaneCollapsed ? "active" : ""}`}
                    onClick={() => setRightPaneCollapsed((v) => !v)}
                    title="Mostrar / colapsar Panel Derecho (Ctrl+Alt+P)"
                  >
                    <Icon icon={FluentPanelRightIcon} size={20} />
                    <span>Historial</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    disabled
                    title="Personalizar densidad y líneas de cuadrícula (próximamente)"
                  >
                    <Icon icon={Grid3X3} size={20} />
                    <span>Cuadrícula</span>
                  </button>
                </div>
                <div className="mr-ribbon-group-label">Paneles y Vista</div>
              </div>
            </>
          )}

          {activeRibbonTab === "ayuda" && (
            <>
              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className="mr-ribbon-btn"
                    disabled
                    title="Documentación oficial (próximamente)"
                  >
                    <Icon icon={Info} size={20} />
                    <span>Documentación</span>
                  </button>
                  <button
                    className="mr-ribbon-btn"
                    onClick={() => setShowShortcutsModal(true)}
                    title="Ver todos los atajos de teclado (?)"
                  >
                    <Icon icon={Keyboard} size={20} />
                    <span>Atajos (?)</span>
                  </button>
                </div>
                <div className="mr-ribbon-group-label">Ayuda</div>
              </div>

              <div className="mr-ribbon-group">
                <div className="mr-ribbon-group-items">
                  <button
                    className="mr-ribbon-btn"
                    onClick={() => {
                      if (BLOG_URL) window.open(BLOG_URL, "_blank", "noopener,noreferrer");
                    }}
                    title={BLOG_URL ? `Abrir Aprender (${BLOG_URL})` : "Aprender (enlace pendiente)"}
                  >
                    <Icon icon={GraduationCap} size={20} />
                    <span>Aprender</span>
                  </button>
                </div>
                <div className="mr-ribbon-group-label">Comunidad</div>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* 3. WORKSPACE (3 Zonas Originales: Izquierda Colapsable | Tabla | Derecha Colapsable) */}
      <div className="mr-workspace">

        {/* ZONE 1: Left Collapsible Pane (Facetas y Clústeres) */}
        {leftPaneCollapsed ? (
          <div
            className="mr-pane-collapsed-strip left"
            onClick={() => setLeftPaneCollapsed(false)}
            title="Expandir Facetas y Clústeres (Ctrl+Alt+L)"
          >
            <Icon icon={ChevronsRight} size={14} />
            <span className="mr-pane-collapsed-label">Facetas y Clústeres</span>
          </div>
        ) : (
        <aside className="mr-pane mr-pane-left">
          <div className="mr-pane-header">
            <span className="mr-pane-header-title">
              <Icon icon={Filter} size={14} />
              Facetas y Clústeres
            </span>
            <button
              className="mr-pane-collapse-btn"
              onClick={() => setLeftPaneCollapsed(true)}
              title="Colapsar panel izquierdo (Ctrl+Alt+L)"
            >
              <Icon icon={ChevronsLeft} size={14} />
            </button>
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
                      ...EMPTY_FACET_FILTERS,
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
                    {diagnostic.errorCount > 0 && (
                      <span className="mr-chip mr-chip-danger">
                        {diagnostic.errorCount} errores
                      </span>
                    )}
                    {diagnostic.controlCharCount > 0 && (
                      <span className="mr-chip mr-chip-warn">
                        {diagnostic.controlCharCount} caract. invisibles
                      </span>
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

                <ColumnQualityBar
                  activeColumn={activeColumn}
                  qualityProfile={qualityProfile}
                  qualityFilter={qualityFilter}
                  onSetQualityFilter={(val) =>
                    updateActiveSession((s) => ({ ...s, qualityFilter: val }))
                  }
                  onPushStep={pushStep}
                />

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
                  {/* Grupo 1: Texto y Formato */}
                  <div className="mr-ops-group">
                    <div className="mr-ops-group-title">
                      <span>Texto y formato</span>
                    </div>
                    <div className="mr-ops-grid">
                      <button
                        className="mr-op-btn"
                        onClick={() => pushStep("trim", activeColumn, `Quitar espacios (${activeColumn})`)}
                      >
                        Quitar espacios
                      </button>
                      <button
                        className="mr-op-btn"
                        onClick={() =>
                          pushStep(
                            "clean_deep",
                            activeColumn,
                            `Trim + Clean profundo (${activeColumn})`
                          )
                        }
                        title="Elimina saltos de línea, tabuladores, espacios NBSP y caracteres invisibles"
                      >
                        Trim + Clean
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
                    </div>
                  </div>

                  {/* Grupo 2: Vacíos y Códigos */}
                  <div className="mr-ops-group">
                    <div className="mr-ops-group-title">
                      <span>Vacíos y códigos</span>
                    </div>
                    <div className="mr-ops-grid">
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
                          pushStep("fill_up", activeColumn, `Rellenar hacia arriba (${activeColumn})`)
                        }
                      >
                        Rellenar arriba
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
                        className="mr-op-btn full"
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
                          className="mr-op-btn mr-op-btn-danger full"
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
                    </div>
                  </div>

                  {/* Grupo 3: Espacio para Fórmulas Cocinadas (Activar / Desactivar / Remover) */}
                  <div className="mr-ops-group">
                    <div className="mr-ops-group-title">
                      <span>Fórmulas rápidas (fx)</span>
                      <button
                        type="button"
                        className="mr-pick-btn"
                        onClick={() => setShowFormulaBar(true)}
                        title="Crear o probar una nueva fórmula (fx)"
                      >
                        + Nueva
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {savedFormulas.length === 0 ? (
                        <span style={{ fontSize: 11, color: "var(--mr-text-muted)" }}>
                          Sin botones guardados. Crea uno desde Fórmula (fx).
                        </span>
                      ) : (
                        savedFormulas.map((fx) => {
                          const resolvedExpr = fx.expression.replace(/\[COL\]/g, `[${activeColumn}]`);
                          return (
                            <div
                              key={fx.id}
                              className={`mr-fx-chip-row ${fx.enabled ? "" : "disabled"}`}
                            >
                              <input
                                type="checkbox"
                                checked={fx.enabled}
                                title="Activar o desactivar este botón de fórmula"
                                onChange={() =>
                                  setSavedFormulas((prev) =>
                                    prev.map((item) =>
                                      item.id === fx.id ? { ...item, enabled: !item.enabled } : item
                                    )
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="mr-fx-chip-btn"
                                disabled={!fx.enabled || !activeColumn}
                                title={`Aplicar ${resolvedExpr}`}
                                onClick={() =>
                                  pushStep(
                                    "formula",
                                    activeColumn,
                                    `fx ${activeColumn}: ${resolvedExpr}`,
                                    {
                                      expression: resolvedExpr,
                                      targetColumn: activeColumn,
                                      mode: "replace",
                                    }
                                  )
                                }
                              >
                                ⚡ {fx.label}
                              </button>
                              <button
                                type="button"
                                className="mr-icon-btn"
                                title="Remover este botón guardado"
                                onClick={() =>
                                  setSavedFormulas((prev) => prev.filter((item) => item.id !== fx.id))
                                }
                              >
                                <X size={12} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

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
                          style={{ color: "var(--mr-danger)" }}
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
                          title="Dividir por delimitador libre (coma, espacio, |) en N columnas o por longitud"
                          onClick={() => {
                            setOpenMenu(null);
                            setActiveActionModal("split");
                          }}
                        >
                          <span>Dividir por delimitador libre / N cols...</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          disabled={columns.length < 2}
                          title="Unir 2 o más columnas con separador personalizado"
                          onClick={() => {
                            setOpenMenu(null);
                            setActiveActionModal("merge");
                          }}
                        >
                          <span>Combinar / fusionar columnas...</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          title="Extraer texto antes, después o entre delimitadores sin fórmulas"
                          onClick={() => {
                            setOpenMenu(null);
                            setActiveActionModal("extract");
                          }}
                        >
                          <span>Extraer texto (delimitador / N car.)...</span>
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
                        <button
                          className="mr-dropdown-item"
                          disabled={activeRows.length < 2}
                          title="Promover la primera fila activa como encabezados de columna"
                          onClick={() => {
                            pushStep(
                              "promote_headers",
                              activeColumn,
                              "Promover 1ª fila como encabezados"
                            );
                            setOpenMenu(null);
                          }}
                        >
                          <span>Usar 1ª fila como encabezado</span>
                        </button>
                        <button
                          className="mr-dropdown-item"
                          disabled={columns.length < 2}
                          title="Convertir columnas seleccionadas en filas Atributo / Valor"
                          onClick={() => {
                            setOpenMenu(null);
                            setActiveActionModal("unpivot");
                          }}
                        >
                          <span>Unpivot (columnas a filas)...</span>
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
                  <SmartFacetsPanel
                    activeColumn={activeColumn}
                    isDateCol={isDateCol}
                    qualityProfile={qualityProfile}
                    duplicateSummary={duplicateSummary}
                    numericRangeProfile={numericRangeProfile}
                    timelineBuckets={timelineBuckets}
                    facets={facets}
                    facetFilter={facetFilter}
                    qualityFilter={qualityFilter}
                    typeFilter={typeFilter}
                    duplicateFilter={duplicateFilter}
                    numericRangeFilter={numericRangeFilter}
                    timelinePeriodFilter={timelinePeriodFilter}
                    filterAlias={filterAlias}
                    isEditingFilterAlias={isEditingFilterAlias}
                    renamingFacetValue={renamingFacetValue}
                    renameFacetDraft={renameFacetDraft}
                    onSetIsEditingFilterAlias={setIsEditingFilterAlias}
                    onSetFilterAlias={(val) =>
                      updateActiveSession((s) => ({ ...s, filterAlias: val }))
                    }
                    onSetFacetFilter={(val) =>
                      updateActiveSession((s) => ({
                        ...s,
                        facetFilter: val,
                        filterAlias: "",
                      }))
                    }
                    onSetTypeFilter={(val) =>
                      updateActiveSession((s) => ({ ...s, typeFilter: val }))
                    }
                    onSetDuplicateFilter={(val) =>
                      updateActiveSession((s) => ({ ...s, duplicateFilter: val }))
                    }
                    onSetNumericRangeFilter={(val) =>
                      updateActiveSession((s) => ({ ...s, numericRangeFilter: val }))
                    }
                    onSetTimelinePeriodFilter={(val) =>
                      updateActiveSession((s) => ({ ...s, timelinePeriodFilter: val }))
                    }
                    onClearAllFacetFilters={clearAllFacetFilters}
                    onSetRenamingFacetValue={setRenamingFacetValue}
                    onSetRenameFacetDraft={setRenameFacetDraft}
                    onCommitFacetRename={handleCommitFacetRename}
                    onPushStep={pushStep}
                  />
                )}
              </>
            )}
          </div>
        </aside>
        )}

        {/* ZONE 2: Center Workspace (SheetTabs arriba + FilterBar + Data Grid) */}
        <main className="mr-zone-center">
          {/* Pestañas de tablas abiertas arriba de la tabla (posición original) */}
          {sessions.length > 0 && (
            <div className="mr-session-tabs top">
              {sessions.map((sess) => {
                const isActive = sess.id === activeSession?.id;
                return (
                  <div
                    key={sess.id}
                    className={`mr-session-tab ${isActive ? "active" : ""}`}
                    onClick={() => setActiveSessionId(sess.id)}
                    title={`${sess.fileName} (${sess.steps.length} pasos aplicados)`}
                  >
                    <Icon icon={FileSpreadsheet} size={14} />
                    <span>{sess.fileName}</span>
                    {sess.steps.length > 0 && (
                      <span className="mr-acc-badge">{sess.steps.length}</span>
                    )}
                    <button
                      type="button"
                      className="mr-session-close"
                      title="Cerrar esta tabla (Alt+W)"
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
              {/* DashCraft Filter / Formula Bar */}
              <div className="mr-filterbar">
                <div className="mr-filterbar-input-wrap">
                  <Icon icon={Filter} size={14} />
                  <input
                    ref={filterInputRef}
                    type="text"
                    className="mr-filterbar-input"
                    placeholder='Filtrar filas en la tabla (ej. "VEND-002" o "2300")...'
                    value={gridFilterDraft}
                    onChange={(e) => setGridFilterDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setAppliedGridFilter(gridFilterDraft);
                      if (e.key === "Escape") {
                        setGridFilterDraft("");
                        setAppliedGridFilter("");
                      }
                    }}
                  />
                </div>
                <button
                  className="mr-btn mr-btn-primary"
                  disabled={!hasData}
                  onClick={() => setAppliedGridFilter(gridFilterDraft)}
                  title="Aplicar filtro de filas (Enter)"
                >
                  Aplicar
                </button>
                {(appliedGridFilter || gridFilterDraft) && (
                  <button
                    className="mr-btn"
                    onClick={() => {
                      setGridFilterDraft("");
                      setAppliedGridFilter("");
                    }}
                    title="Limpiar filtro"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  type="button"
                  className="mr-icon-btn"
                  onClick={() => setShowFilterHelp((v) => !v)}
                  title="Cómo funciona el filtro rápido de ModernRefine"
                >
                  <Icon icon={Info} size={14} />
                </button>
                <button
                  type="button"
                  className={`mr-btn ${showFormulaBar ? "mr-btn-primary" : ""}`}
                  disabled={!hasData}
                  onClick={() => {
                    setShowFormulaBar((v) => !v);
                    setFormulaPreviewState(null);
                  }}
                  title="Abrir barra de Fórmulas Seguras (fx) e integración LLM"
                >
                  <Icon icon={Sparkles} size={14} /> Fórmula (fx)
                </button>
                {hasData && (
                  <>
                    <button
                      type="button"
                      className="mr-btn"
                      onClick={() =>
                        pushStep("add_row", activeColumn || columns[0], "Agregar fila en blanco")
                      }
                      title="Agregar una nueva fila editable al final de la tabla"
                    >
                      + Fila
                    </button>
                    <button
                      type="button"
                      className="mr-btn"
                      onClick={() =>
                        pushStep(
                          "add_column",
                          activeColumn || columns[0],
                          `Agregar columna Columna_${columns.length + 1}`,
                          { newColumnName: `Columna_${columns.length + 1}` }
                        )
                      }
                      title="Agregar una nueva columna al final de la tabla"
                    >
                      + Col
                    </button>
                  </>
                )}
                <span className="mr-filterbar-meta">
                  {hasData ? `${visibleRows.length} filas` : "0 filas"}
                </span>

                {totalPages > 1 && activeSession && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      className="mr-btn"
                      disabled={currentPage <= 0}
                      onClick={() =>
                        setPageBySession((p) => ({
                          ...p,
                          [activeSession.id]: Math.max(0, currentPage - 1),
                        }))
                      }
                      title="Página anterior"
                    >
                      ◀
                    </button>
                    <span className="mr-filterbar-meta">
                      {currentPage + 1}/{totalPages}
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
                      title="Página siguiente"
                    >
                      ▶
                    </button>
                  </div>
                )}

                {sortState && (
                  <button
                    className="mr-btn"
                    onClick={() => updateActiveSession((s) => ({ ...s, sortState: null }))}
                    title="Restablecer orden original"
                  >
                    ✕ Orden
                  </button>
                )}
                {selectedRealRowIdx !== null && (
                  <button
                    className="mr-btn mr-btn-danger"
                    onClick={handleDeleteSelectedRow}
                    title="Eliminar la fila seleccionada"
                  >
                    <Icon icon={Trash2} size={14} /> Fila #{selectedRealRowIdx + 1}
                  </button>
                )}
              </div>

          {showFilterHelp && (
            <div className="mr-filter-help">
              <div>
                <strong>Filtro rápido en memoria (motor ModernRefine):</strong> Busca texto parcial
                en todas las columnas visibles de la tabla activa, sin distinguir mayúsculas o
                minúsculas (no requiere SQL). Presiona <code>Enter</code> o <strong>Aplicar</strong>{" "}
                para filtrar, <code>Esc</code> para limpiar, o haz clic en una faceta del panel
                izquierdo para aislar un valor exacto.
              </div>
              {columns.length > 0 && (
                <div className="mr-filter-help-cols">
                  <span style={{ color: "var(--mr-text-muted)", marginRight: 2 }}>
                    Seleccionar columna:
                  </span>
                  {columns.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="mr-filter-col-pill"
                      onClick={() =>
                        updateActiveSession((s) => ({
                          ...s,
                          selectedColumn: c,
                          selectionMode: "column",
                        }))
                      }
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasData && showFormulaBar && (
            <div className="mr-formulabar">
              <div className="mr-formulabar-row">
                <span className="mr-fx-prefix">fx</span>
                <input
                  type="text"
                  className="mr-filterbar-input"
                  style={{
                    flex: 1,
                    minWidth: 220,
                    height: 26,
                    padding: "0 8px",
                    background: "var(--mr-surface)",
                    border: "1px solid var(--mr-border)",
                    borderRadius: "var(--mr-radius)",
                  }}
                  placeholder={`Escribe fórmula o pega JSON de LLM (ej. TRIM(UPPER([${activeColumn || "Columna"}])))`}
                  value={formulaInput}
                  onChange={(e) => {
                    setFormulaInput(e.target.value);
                    setFormulaPreviewState(null);
                  }}
                />
                <select
                  className="mr-date-select"
                  style={{ width: 165 }}
                  value=""
                  onChange={(e) => {
                    const expr = e.target.value;
                    if (!expr) return;
                    setFormulaInput(expr);
                    setFormulaPreviewState(null);
                  }}
                  title="Recetario rápido para aprendices"
                >
                  <option value="">Recetario rápido...</option>
                  <option value={`TRIM(PROPER([${activeColumn}]))`}>Limpiar y Título</option>
                  <option value={`UPPER(REMOVE_ACCENTS([${activeColumn}]))`}>
                    MAYÚSCULAS sin acentos
                  </option>
                  <option value={`IF(ISBLANK([${activeColumn}]), "Pendiente", [${activeColumn}])`}>
                    Vacíos → "Pendiente"
                  </option>
                  <option value={`NORMALIZE_PHONE_MX([${activeColumn}])`}>
                    Teléfono +52 (10 díg.)
                  </option>
                  <option value={`PAD_CP([${activeColumn}])`}>CP 5 dígitos (0...)</option>
                </select>
                <select
                  className="mr-date-select"
                  style={{ width: 150 }}
                  value={formulaMode}
                  onChange={(e) =>
                    setFormulaMode(e.target.value === "new_column" ? "new_column" : "replace")
                  }
                >
                  <option value="replace">Reemplazar "{activeColumn}"</option>
                  <option value="new_column">Nueva columna</option>
                </select>
                {formulaMode === "new_column" && (
                  <input
                    type="text"
                    className="mr-date-select"
                    style={{ width: 135 }}
                    placeholder={`${activeColumn}_Limpio`}
                    value={formulaNewColName}
                    onChange={(e) => setFormulaNewColName(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  onClick={() => {
                    const parsed = parseFormulaOrLlmJson(formulaInput);
                    const mode = parsed.mode ?? formulaMode;
                    const targetCol =
                      parsed.targetColumn?.trim() ||
                      (mode === "new_column"
                        ? formulaNewColName.trim() || `${activeColumn}_fx`
                        : activeColumn);
                    const sourceColForBefore = columns.includes(targetCol)
                      ? targetCol
                      : activeColumn;
                    const res = previewFormulaOnRows(
                      parsed.expression,
                      columns,
                      currentDataRows,
                      sourceColForBefore,
                      5
                    );
                    if (res.ok) {
                      setFormulaPreviewState({
                        status: "ok",
                        expression: parsed.expression,
                        targetCol,
                        mode,
                        rows: res.previews,
                      });
                    } else {
                      setFormulaPreviewState({ status: "error", message: res.error });
                    }
                  }}
                >
                  Probar 5 filas
                </button>
                <button
                  type="button"
                  className="mr-btn"
                  onClick={() => {
                    const prompt = buildLlmPromptForTable(columns, currentDataRows, activeColumn);
                    navigator.clipboard?.writeText(prompt);
                    setLlmPromptCopied(true);
                    setTimeout(() => setLlmPromptCopied(false), 2200);
                  }}
                  title="Copia las columnas, 3 filas de muestra y reglas seguras para pegar en ChatGPT/Claude"
                >
                  {llmPromptCopied ? "✓ Prompt copiado" : "Copiar para LLM"}
                </button>
              </div>

              {formulaPreviewState?.status === "error" && (
                <div className="mr-formula-error">⚠ {formulaPreviewState.message}</div>
              )}

              {formulaPreviewState?.status === "ok" && (
                <div className="mr-formula-preview">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      Vista previa en 5 filas → Destino:{" "}
                      <strong>{formulaPreviewState.targetCol}</strong> (
                      {formulaPreviewState.mode === "new_column" ? "nueva columna" : "reemplazo"})
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="mr-btn"
                        onClick={() => setFormulaPreviewState(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="mr-btn"
                        title="Guardar esta fórmula como botón reutilizable en el panel izquierdo"
                        onClick={() => {
                          const shortLabel =
                            formulaPreviewState.expression.length > 22
                              ? `${formulaPreviewState.expression.slice(0, 20)}…`
                              : formulaPreviewState.expression;
                          setSavedFormulas((prev) => [
                            ...prev,
                            {
                              id: `fx_${Date.now()}`,
                              label: shortLabel,
                              expression: formulaPreviewState.expression,
                              enabled: true,
                            },
                          ]);
                        }}
                      >
                        + Guardar botón
                      </button>
                      <button
                        type="button"
                        className="mr-btn mr-btn-primary"
                        onClick={() => {
                          pushStep(
                            "formula",
                            activeColumn,
                            `fx ${formulaPreviewState.targetCol}: ${formulaPreviewState.expression}`,
                            {
                              expression: formulaPreviewState.expression,
                              targetColumn: formulaPreviewState.targetCol,
                              mode: formulaPreviewState.mode,
                            }
                          );
                          setFormulaPreviewState(null);
                          setFormulaInput("");
                        }}
                      >
                        Aplicar a la Receta
                      </button>
                    </div>
                  </div>
                  <table className="mr-formula-preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: 50 }}>Fila</th>
                        <th>Antes</th>
                        <th>Después (resultado)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formulaPreviewState.rows.map((r) => (
                        <tr key={r.rowNum}>
                          <td>#{r.rowNum}</td>
                          <td>{r.before || "∅"}</td>
                          <td style={{ color: "var(--mr-accent)", fontWeight: 600 }}>
                            {r.after || "∅"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {hasData && selectionMode === "column" && isDateCol && (
            <div className="mr-col-banner">
              <span style={{ fontSize: 12, fontWeight: 600 }}>
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
                <p style={{ margin: "0 0 18px", color: "var(--mr-text-muted)", lineHeight: 1.55 }}>
                  Abre archivos locales (<code>.xlsx</code>, <code>.csv</code>, <code>.tsv</code>,{" "}
                  <code>.ods</code> o <code>.json</code>), crea una tabla en blanco o importa datos
                  desde Web, Wikipedia y SQL.
                </p>

                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    className="mr-btn mr-btn-primary"
                    onClick={() => triggerFilePicker()}
                    title="Abrir uno o varios archivos de datos (Ctrl+O)"
                  >
                    <Upload size={14} /> Abrir archivo
                  </button>
                  <button
                    className="mr-btn"
                    onClick={() => setActiveActionModal("new_table")}
                    title="Crear una nueva tabla editable en blanco desde cero"
                  >
                    <FilePlus2 size={14} /> Nueva tabla
                  </button>
                  <button
                    className="mr-btn"
                    onClick={() => setGetDataTarget("catalog")}
                    title="Conectar desde Web, Wikipedia o Base de datos SQL"
                  >
                    <Database size={14} /> Obtener datos
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mr-grid-body">
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
                      const isSorted = sortState?.column === col;
                      const sortDir = isSorted ? sortState.dir : null;

                      return (
                        <th
                          key={col}
                          className={isColActive ? "selected-col" : ""}
                          title={`Clic para seleccionar toda la columna "${col}"`}
                          onClick={() => {
                            updateActiveSession((s) => ({
                              ...s,
                              selectedColumn: col,
                              selectionMode: "column",
                              ...EMPTY_FACET_FILTERS,
                              selectedCell: {
                                visibleIdx: s.selectedCell?.visibleIdx ?? 0,
                                colIdx,
                              },
                            }));
                          }}
                        >
                          <div className="mr-th-inner">
                            <span>{col}</span>
                            <button
                              type="button"
                              className="mr-th-chevron"
                              title={`Ordenar "${col}" (menor a mayor / alfabético)`}
                              onClick={(e) => handleToggleColumnSort(col, e)}
                            >
                              {sortDir === "asc" ? (
                                <ArrowUp size={12} />
                              ) : sortDir === "desc" ? (
                                <ArrowDown size={12} />
                              ) : (
                                <ChevronDown size={12} />
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
                          const isErrorCell = !isEmpty && isErrorCellValue(val);
                          const isEditing =
                            editingCell?.origIdx === origIdx && editingCell?.col === col;
                          const isCellSelected =
                            selectionMode === "cell" &&
                            isRowSelected &&
                            selectedCell?.colIdx === colIdx;
                          const isColSelected = col === activeColumn;

                          return (
                            <td
                              key={col}
                              data-cell={`${visibleIdx}-${colIdx}`}
                              className={[
                                isEmpty ? "mr-empty-cell" : "",
                                isErrorCell ? "mr-error-cell" : "",
                                isColSelected ? "selected-col-cell" : "",
                                isCellSelected ? "selected-cell" : "",
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
                                  selectedColumn: col,
                                }));
                                setShowColInspector(true);
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

            {showColInspector && activeColumn && (
              <aside className="mr-col-inspector-card" aria-label="Resumen rápido de columna">
                <div className="mr-pane-header" style={{ height: 30, fontSize: 12.5 }}>
                  <span className="mr-pane-header-title">{activeColumn}</span>
                  <button
                    type="button"
                    className="mr-pane-collapse-btn"
                    onClick={() => setShowColInspector(false)}
                    title="Cerrar resumen de columna"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="mr-col-inspector-body">
                  <div className="mr-kv-list">
                    <div className="mr-kv-row" title="Tipo de datos predominante en esta columna">
                      <span className="mr-kv-label">Tipo detectado</span>
                      <span className="mr-kv-val">
                        {isDateCol ? "Fecha" : colStats?.isNumeric ? "Número" : "Texto"}
                      </span>
                    </div>
                  </div>

                  {diagnostic && (
                    <div className="mr-kv-list">
                      <div className="mr-kv-row" title="Número total de registros en la tabla">
                        <span className="mr-kv-label">Total de filas</span>
                        <span className="mr-kv-val">{currentDataRows.length}</span>
                      </div>
                      <div className="mr-kv-row" title="Celdas que sí tienen algún valor escrito">
                        <span className="mr-kv-label">Con dato</span>
                        <span className="mr-kv-val">
                          {currentDataRows.length - diagnostic.emptyCount}
                        </span>
                      </div>
                      <div className="mr-kv-row" title="Celdas en blanco que podrían necesitar limpieza">
                        <span className="mr-kv-label">Vacías</span>
                        <span className={`mr-kv-val ${diagnostic.emptyCount > 0 ? "danger" : ""}`}>
                          {diagnostic.emptyCount} (
                          {currentDataRows.length > 0
                            ? ((diagnostic.emptyCount / currentDataRows.length) * 100).toFixed(0)
                            : "0"}
                          %)
                        </span>
                      </div>
                      <div
                        className="mr-kv-row"
                        title="Cantidad de respuestas únicas (útil para detectar variantes)"
                      >
                        <span className="mr-kv-label">Valores distintos</span>
                        <span className="mr-kv-val">{diagnostic.uniqueCount}</span>
                      </div>
                      {qualityProfile && (
                        <>
                          <div className="mr-kv-row" title="Porcentaje de celdas válidas sin anomalías">
                            <span className="mr-kv-label">Calidad válida</span>
                            <span className="mr-kv-val">{qualityProfile.validPercent}%</span>
                          </div>
                          {qualityProfile.suspectCount > 0 && (
                            <div className="mr-kv-row" title="Errores, caracteres invisibles o tipos mixtos">
                              <span className="mr-kv-label">Errores / Incons.</span>
                              <span className="mr-kv-val danger">
                                {qualityProfile.suspectCount} ({qualityProfile.suspectPercent}%)
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      {duplicateSummary && duplicateSummary.duplicateColumnRows > 0 && (
                        <div className="mr-kv-row" title="Filas con valores repetidos en esta columna">
                          <span className="mr-kv-label">Duplicados (col)</span>
                          <span className="mr-kv-val warn">{duplicateSummary.duplicateColumnRows}</span>
                        </div>
                      )}
                      {colStats?.isNumeric && colStats.min !== null && colStats.max !== null && (
                        <>
                          <div className="mr-kv-row" title="Valor numérico más pequeño">
                            <span className="mr-kv-label">Mínimo</span>
                            <span className="mr-kv-val">{colStats.min}</span>
                          </div>
                          <div className="mr-kv-row" title="Valor numérico más grande">
                            <span className="mr-kv-label">Máximo</span>
                            <span className="mr-kv-val">{colStats.max}</span>
                          </div>
                        </>
                      )}
                      {diagnostic.whitespaceIssueCount > 0 && (
                        <div className="mr-kv-row" title="Celdas con espacios sobrantes">
                          <span className="mr-kv-label">Espacios extra</span>
                          <span className="mr-kv-val warn">{diagnostic.whitespaceIssueCount}</span>
                        </div>
                      )}
                      {diagnostic.shortPostalCodeCount > 0 && (
                        <div className="mr-kv-row" title="Códigos postales de 4 dígitos sin cero inicial">
                          <span className="mr-kv-label">CP sin 0 inicial</span>
                          <span className="mr-kv-val warn">{diagnostic.shortPostalCodeCount}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mr-inspector-note">
                    Resumen de toda la columna (no cambia al filtrar la tabla).
                  </div>
                </div>
              </aside>
            )}
            </div>
          )}
        </main>

        {/* ZONE 3: Right Collapsible Pane (Historial, Papelera & Receta) */}
        {rightPaneCollapsed ? (
          <div
            className="mr-pane-collapsed-strip right"
            onClick={() => setRightPaneCollapsed(false)}
            title="Expandir Datos y Pasos (Ctrl+Alt+P)"
          >
            <Icon icon={ChevronsLeft} size={14} />
            <span className="mr-pane-collapsed-label">Datos y Pasos</span>
          </div>
        ) : (
        <aside className="mr-pane mr-pane-right">
          <div className="mr-pane-header">
            <span className="mr-pane-header-title">
              <Icon icon={History} size={14} />
              Datos y Pasos
            </span>
            <button
              className="mr-pane-collapse-btn"
              onClick={() => setRightPaneCollapsed(true)}
              title="Colapsar panel derecho (Ctrl+Alt+P)"
            >
              <Icon icon={ChevronsRight} size={14} />
            </button>
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
        )}
      </div>

      {/* 4. STATUS BAR (24px, DashCraft Style) */}
      <footer className="mr-statusbar">
        <div className="mr-status-left">
          <span>
            {hasData
              ? `Tabla: ${fileName} (${currentDataRows.length} filas) | Columna: ${activeColumn} (${
                  diagnostic?.uniqueCount ?? 0
                } valores únicos) | ${steps.length} pasos aplicados`
              : "Listo — Abre un archivo CSV/Excel o elige una plantilla"}
          </span>
        </div>
        <div className="mr-status-right">
          <span>
            <span className={`mr-status-dot ${hasData ? "" : "idle"}`} />
            {hasData ? "Datos cargados" : "Sin datos"}
          </span>
          {diagnostic && (
            <span>
              Vacías: {diagnostic.emptyCount} · Espacios: {diagnostic.whitespaceIssueCount}
            </span>
          )}
          <span>ModernRefine 0.1.0</span>
        </div>
      </footer>

      {/* 5. BACKSTAGE DE ARCHIVO (Estilo Office / DashCraft) */}
      {showFileBackstage && (
        <div className="mr-backstage">
          <nav className="mr-backstage-nav" aria-label="Menú Archivo">
            <button
              type="button"
              className="mr-backstage-back"
              onClick={() => setShowFileBackstage(false)}
              title="Volver al área de trabajo (Esc)"
            >
              <Icon icon={ArrowLeft} size={16} />
            </button>
            <button
              type="button"
              className="mr-backstage-item"
              onClick={() => {
                setShowFileBackstage(false);
                setActiveActionModal("new_table");
              }}
              title="Crear una nueva tabla editable en blanco"
            >
              <Icon icon={FilePlus2} size={16} />
              <span>Nuevo</span>
            </button>
            <button
              type="button"
              className={`mr-backstage-item ${backstageSection === "open" ? "active" : ""}`}
              onClick={() => setBackstageSection("open")}
            >
              <Icon icon={FolderOpen} size={16} />
              <span>Abrir</span>
            </button>
            <button
              type="button"
              className={`mr-backstage-item ${backstageSection === "recipes" ? "active" : ""}`}
              onClick={() => setBackstageSection("recipes")}
            >
              <Icon icon={FluentRecipeIcon} size={16} />
              <span>Recetas (.json)</span>
            </button>
            <button
              type="button"
              className={`mr-backstage-item ${backstageSection === "export" ? "active" : ""}`}
              onClick={() => setBackstageSection("export")}
            >
              <Icon icon={Download} size={16} />
              <span>Exportar</span>
            </button>

            <div className="mr-backstage-divider" />

            <button
              type="button"
              className="mr-backstage-item"
              onClick={() => {
                setShowFileBackstage(false);
                setGetDataTarget("catalog");
              }}
              title="Abrir catálogo Obtener datos (Excel, CSV, Web, Wikipedia o SQL)"
            >
              <Icon icon={Database} size={16} />
              <span>Obtener datos</span>
            </button>
            <button
              type="button"
              className="mr-backstage-item"
              disabled
              title="Comparar versiones de tabla (próximamente)"
            >
              <Icon icon={GitCompare} size={16} />
              <span>Comparar</span>
            </button>
            <button
              type="button"
              className="mr-backstage-item"
              disabled
              title="Enviar tabla limpia a Analyticraft (próximamente)"
            >
              <Icon icon={Send} size={16} />
              <span>Enviar a Analyticraft</span>
            </button>

            <div className="mr-backstage-divider" />

            <button
              type="button"
              className={`mr-backstage-item ${backstageSection === "about" ? "active" : ""}`}
              onClick={() => setBackstageSection("about")}
            >
              <Icon icon={Info} size={16} />
              <span>Acerca del proyecto</span>
            </button>
            <button
              type="button"
              className="mr-backstage-item"
              onClick={() => {
                setShowFileBackstage(false);
                setShowShortcutsModal(true);
              }}
            >
              <Icon icon={Keyboard} size={16} />
              <span>Atajos de teclado</span>
            </button>
            <button
              type="button"
              className="mr-backstage-item"
              disabled={!hasData}
              onClick={() => {
                handleCloseSession();
                setShowFileBackstage(false);
              }}
            >
              <Icon icon={X} size={16} />
              <span>Cerrar tabla activa</span>
            </button>
          </nav>

          <section className="mr-backstage-content">
            {backstageSection === "open" && (
              <>
                <h2 className="mr-backstage-title">Abrir</h2>
                <button
                  type="button"
                  className="mr-backstage-card"
                  onClick={() => {
                    setShowFileBackstage(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Icon icon={FolderOpen} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">Examinar este equipo</div>
                    <div className="mr-backstage-card-sub">
                      CSV, TSV, TXT, Excel (.xlsx / .xls), ODS o JSON (Ctrl+O)
                    </div>
                  </div>
                </button>

                {ROOT_CSV_TEMPLATES.length > 0 && (
                  <div style={{ marginTop: 22 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--mr-text-secondary)",
                        marginBottom: 10,
                      }}
                    >
                      Plantillas de prueba en raíz
                    </div>
                    {ROOT_CSV_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        className="mr-backstage-card"
                        onClick={() => {
                          loadCsvIntoSession(tpl.name, tpl.content);
                          setShowFileBackstage(false);
                        }}
                      >
                        <Icon icon={FileSpreadsheet} size={20} />
                        <div>
                          <div className="mr-backstage-card-title">{tpl.name}</div>
                          <div className="mr-backstage-card-sub">
                            Abrir archivo de ejemplo en una pestaña independiente
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {backstageSection === "recipes" && (
              <>
                <h2 className="mr-backstage-title">Recetas ETL (.refine.json)</h2>
                <button
                  type="button"
                  className="mr-backstage-card"
                  disabled={!hasData}
                  onClick={() => {
                    setShowFileBackstage(false);
                    recipeInputRef.current?.click();
                  }}
                >
                  <Icon icon={FolderInput} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">Cargar receta previa (.json)</div>
                    <div className="mr-backstage-card-sub">
                      Reaplica pasos guardados sobre la tabla activa (Ctrl+Shift+O)
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="mr-backstage-card"
                  disabled={!hasData}
                  onClick={() => {
                    setShowFileBackstage(false);
                    handleSaveRecipe();
                  }}
                >
                  <Icon icon={Save} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">
                      Guardar receta "{cleanTableName || "tabla"}.refine.json"
                    </div>
                    <div className="mr-backstage-card-sub">
                      Exporta la cadena reproducible de pasos en formato JSON (Ctrl+S)
                    </div>
                  </div>
                </button>
              </>
            )}

            {backstageSection === "export" && (
              <>
                <h2 className="mr-backstage-title">Exportar tabla limpia</h2>
                <button
                  type="button"
                  className="mr-backstage-card"
                  disabled={!hasData}
                  onClick={() => {
                    setShowFileBackstage(false);
                    handleExportXlsx();
                  }}
                >
                  <Icon icon={FileSpreadsheet} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">Exportar a libro Excel (.xlsx)</div>
                    <div className="mr-backstage-card-sub">
                      Abre el cuadro Guardar como... para generar un Excel limpio (Ctrl+Shift+E)
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="mr-backstage-card"
                  disabled={!hasData}
                  onClick={() => {
                    setShowFileBackstage(false);
                    handleExportCsv();
                  }}
                >
                  <Icon icon={Download} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">Exportar a CSV (.csv)</div>
                    <div className="mr-backstage-card-sub">
                      Abre el cuadro Guardar como... en texto delimitado por comas (Ctrl+E)
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="mr-backstage-card"
                  disabled={!hasData}
                  onClick={() => {
                    setShowFileBackstage(false);
                    handleExportParquet();
                  }}
                >
                  <Icon icon={Database} size={20} />
                  <div>
                    <div className="mr-backstage-card-title">
                      Exportar a Apache Parquet (.parquet)
                    </div>
                    <div className="mr-backstage-card-sub">
                      Generación columnar de alta velocidad mediante DuckDB Nativo (Tauri Desktop)
                    </div>
                  </div>
                </button>
              </>
            )}

            {backstageSection === "about" && (
              <div className="mr-about-container">
                {/* Hero Header */}
                <div className="mr-about-hero">
                  <h2 className="mr-about-hero-title">
                    <img
                      src="/mR_harmonia_cutout.png"
                      alt="ModernRefine"
                      style={{ width: 28, height: 28, objectFit: "contain" }}
                    />
                    ModernRefine
                  </h2>
                  <p style={{ margin: "4px 0 0", color: "var(--mr-text-secondary)", fontSize: 13.5 }}>
                    <strong>Estación de limpieza de datos (<em>Pre-BI Cleaning Station</em>)</strong>{" "}
                    minimalista, nativa y <em>local-first</em>. Diseñada para transformar archivos CSV,
                    Excel y JSON sucios en tablas confiables sin escribir código.
                  </p>
                  <div className="mr-about-badge-row">
                    <span className="mr-about-badge accent">v0.1.0</span>
                    <span className="mr-about-badge">100% Local-First</span>
                    <span className="mr-about-badge">Tauri v2 + Rust</span>
                    <span className="mr-about-badge">Cero Telemetría</span>
                    <span className="mr-about-badge">Recetas .refine.json</span>
                  </div>
                </div>

                {/* ¿A quién está dirigido? */}
                <div className="mr-about-section">
                  <h3 className="mr-about-section-title">
                    <Icon icon={Database} size={16} style={{ color: "var(--mr-accent)" }} />
                    ¿A quién está dirigido ModernRefine?
                  </h3>
                  <div className="mr-about-grid">
                    <div className="mr-about-card">
                      <div className="mr-about-card-title">
                        📊 Analistas de Datos y de Negocio
                      </div>
                      <div className="mr-about-card-desc">
                        Que reciben extracciones caóticas de ERPs (SAP, Oracle, Salesforce) o censos y
                        necesitan perfilar, quitar duplicados y homologar catálogos en minutos.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">
                        🛑 Usuarios de Excel al límite
                      </div>
                      <div className="mr-about-card-desc">
                        Cansados de bloqueos con 500k filas, ceros borrados en Códigos Postales
                        (<code>08600</code> → <code>8600</code>), fechas alteradas en silencio y
                        miedo a arruinar el archivo con un <em>Buscar y Reemplazar</em>.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">
                        📋 Contadores, Auditores y Operadores
                      </div>
                      <div className="mr-about-card-desc">
                        Que manipulan padrones, nóminas, facturación e inventarios y exigen
                        trazabilidad total: auditar exactamente qué cambió paso a paso sin destruir el
                        archivo original.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">
                        🚀 Data Engineers y Equipos Pre-BI
                      </div>
                      <div className="mr-about-card-desc">
                        La antesala perfecta para preparar, ordenar y tipar datos antes de cargarlos a
                        Power BI, Tableau o DashCraft/Analyticraft con recetas portables y repetibles.
                      </div>
                    </div>
                  </div>
                </div>

                {/* ¿Cómo te ayuda ModernRefine? */}
                <div className="mr-about-section">
                  <h3 className="mr-about-section-title">
                    <Icon icon={CheckCircle2} size={16} style={{ color: "var(--mr-accent)" }} />
                    ¿Cómo te ayuda este software?
                  </h3>
                  <div className="mr-about-grid">
                    <div className="mr-about-card">
                      <div className="mr-about-card-title">🔒 Privacidad Absoluta (Local-First)</div>
                      <div className="mr-about-card-desc">
                        Tus archivos nunca tocan la nube ni servidores de terceros. Trabajas sin
                        conexión y sin telemetría, cumpliendo con la confidencialidad de tus datos.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">↩️ 100% Reversible y Auditable</div>
                      <div className="mr-about-card-desc">
                        Todo cambio es un paso independiente en el historial. Puedes prender, apagar o
                        descartar pasos individuales sin miedo a equivocarte y con papelera de recuperación.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">🛡️ Respeto Estricto de los Datos</div>
                      <div className="mr-about-card-desc">
                        Nunca trunca ceros por la izquierda, respeta claves alfanuméricas y ofrece 7
                        formatos inteligentes para estandarizar fechas sin corromper registros.
                      </div>
                    </div>

                    <div className="mr-about-card">
                      <div className="mr-about-card-title">⚡ Rendimiento Nativo en Rust</div>
                      <div className="mr-about-card-desc">
                        Virtualización de filas en pantalla y motor en Rust para ejecutar clustering y
                        transformaciones masivas sin congelar tu equipo ni consumir gigas de RAM.
                      </div>
                    </div>

                    <div className="mr-about-card" style={{ gridColumn: "1 / -1" }}>
                      <div className="mr-about-card-title">📝 Recetas Automatizables (.refine.json)</div>
                      <div className="mr-about-card-desc">
                        Si cada lunes te entregan el mismo reporte sucio, limpias una vez, guardas la
                        receta y la próxima semana la aplicas en segundos. Sin macros frágiles ni código.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Guiño a OpenRefine: ¿Por qué dar el salto? */}
                <div className="mr-about-section">
                  <h3 className="mr-about-section-title">
                    <Icon icon={RotateCcw} size={16} style={{ color: "var(--mr-accent)" }} />
                    El guiño a OpenRefine: ¿Por qué soltar la herramienta anterior?
                  </h3>
                  <p style={{ margin: "0 0 10px", color: "var(--mr-text-secondary)", fontSize: 12.5 }}>
                    Reconocemos y honramos la genialidad de <strong>OpenRefine</strong>: introdujo al mundo
                    el revolucionario concepto de facetas y clustering de texto. Sin embargo, su arquitectura
                    de hace más de una década arrastra compromisos técnicos que hoy puedes dejar atrás:
                  </p>

                  <table className="mr-about-vs-table">
                    <thead>
                      <tr>
                        <th style={{ width: "24%" }}>Aspecto</th>
                        <th style={{ width: "38%" }}>OpenRefine Clásico</th>
                        <th style={{ width: "38%", color: "var(--mr-accent)" }}>ModernRefine</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Motor y dependencias</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Requiere instalar Java JRE / JDK, lidiar con versiones y variables de entorno.
                        </td>
                        <td>
                          <strong>Binario nativo en Rust + Tauri v2:</strong> sin Java, sin configuración previa, ligero y autocontenido.
                        </td>
                      </tr>
                      <tr>
                        <td><strong>Entorno de ejecución</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Levanta un servidor HTTP local en segundo plano y corre en una pestaña del navegador web.
                        </td>
                        <td>
                          <strong>Aplicación de escritorio nativa:</strong> ventana independiente sin competir con los recursos de tu navegador.
                        </td>
                      </tr>
                      <tr>
                        <td><strong>Experiencia e interfaz</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Diseño web clásico de 2010, menús rígidos y navegación pesada.
                        </td>
                        <td>
                          <strong>Estilo Office / Fluent 2:</strong> Ribbon compacto, paneles laterales colapsables, filtros rápidos y estética moderna.
                        </td>
                      </tr>
                      <tr>
                        <td><strong>Multi-tarea</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Proyectos aislados que requieren abrir múltiples ventanas o pestañas web.
                        </td>
                        <td>
                          <strong>Sesiones multi-pestaña reales:</strong> abre y limpia múltiples tablas simultáneamente con historiales separados.
                        </td>
                      </tr>
                      <tr>
                        <td><strong>Enfoque en español y México</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Clustering estándar en inglés; separación de nombres genérica.
                        </td>
                        <td>
                          <strong>Heurísticas contextuales:</strong> detector de nombres latinos (partículas <em>de, del, de la</em> y apellidos paterno/materno) y abreviaturas mexicanas (<em>CDMX, Gdl, Mty, Q. Roo</em>).
                        </td>
                      </tr>
                      <tr>
                        <td><strong>Fórmulas e IA</strong></td>
                        <td style={{ color: "var(--mr-text-muted)" }}>
                          Expresiones GREL complejas de aprender y redactar.
                        </td>
                        <td>
                          <strong>Barra <em>fx</em> segura y puente con LLMs:</strong> copia prompts con esquemas listos para que ChatGPT o Gemini generen tus recetas JSON.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Ecosistema y enlaces */}
                <div className="mr-about-section">
                  <h3 className="mr-about-section-title">
                    <Icon icon={Info} size={16} style={{ color: "var(--mr-accent)" }} />
                    Ecosistema Analyticraft
                  </h3>
                  <p style={{ margin: "0 0 10px", color: "var(--mr-text-secondary)", fontSize: 12.5 }}>
                    ModernRefine forma parte del ecosistema de inteligencia y analítica independiente:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <a
                      href="https://github.com/seargentpepper/Analyticraft/tree/main/modern-refine"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-about-link-pill"
                    >
                      <Icon icon={ExternalLink} size={13} />
                      Repositorio ModernRefine en GitHub
                    </a>
                    <a
                      href="https://seargentpepper.github.io/Analyticraft/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-about-link-pill"
                    >
                      <Icon icon={ExternalLink} size={13} />
                      Sitio Oficial Analyticraft
                    </a>
                    <a
                      href="https://github.com/seargentpepper/Analyticraft"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-about-link-pill"
                    >
                      <Icon icon={ExternalLink} size={13} />
                      GitHub Analyticraft
                    </a>
                  </div>
                </div>

                {/* Avisos de terceros */}
                <div className="mr-about-section" style={{ marginBottom: 0 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px", color: "var(--mr-text)" }}>
                    Recursos y licencias de terceros
                  </h4>
                  <ul style={{ paddingLeft: 18, margin: 0, color: "var(--mr-text-secondary)", fontSize: 12 }}>
                    <li>
                      <strong>Fluent UI System Icons</strong> — MIT License, © Microsoft Corporation
                    </li>
                    <li>
                      <strong>Lucide Icons</strong> — ISC License, © Lucide Contributors
                    </li>
                    <li>
                      <strong>Calamine &amp; Rayon</strong> — Motores de lectura y procesamiento paralelo en Rust (MIT / Apache-2.0)
                    </li>
                  </ul>
                  <p style={{ fontSize: 11.5, color: "var(--mr-text-muted)", marginTop: 8 }}>
                    Consulta los avisos y licencias completas en el archivo <code>THIRD_PARTY_NOTICES.md</code>.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 6. DIALOG OFFICE DE ATAJOS DE TECLADO (?) */}
      {showShortcutsModal && (
        <div className="mr-dialog-overlay" onClick={() => setShowShortcutsModal(false)}>
          <div className="mr-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="mr-dialog-header">
              <span>Atajos de teclado — ModernRefine</span>
              <button
                className="mr-pane-collapse-btn"
                onClick={() => setShowShortcutsModal(false)}
                title="Cerrar (Esc)"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mr-dialog-body">
              {[
                ["Abrir archivo(s)", "Ctrl + O"],
                ["Cargar / Guardar receta JSON", "Ctrl + Shift + O / Ctrl + S"],
                ["Exportar CSV / Excel XLSX", "Ctrl + E / Ctrl + Shift + E"],
                ["Deshacer / Rehacer", "Ctrl + Z / Ctrl + Y"],
                ["Buscar columna o comando", "Ctrl + K"],
                ["Filtrar filas del grid", "Ctrl + F"],
                ["Colapsar Panel Izquierdo / Panel Derecho", "Ctrl + Alt + L / P"],
                ["Cerrar pestaña activa", "Alt + W"],
                ["Duplicar / Renombrar / Ocultar columna", "Alt + D / R / X"],
                ["Dividir columna (- / Izq / Der / Nombre)", "Alt + 2 / I / U / N"],
              ].map(([label, kbd]) => (
                <div key={label} className="mr-shortcut-row">
                  <span>{label}</span>
                  <kbd className="mr-shortcut-kbd">{kbd}</kbd>
                </div>
              ))}
            </div>
            <div className="mr-dialog-footer">
              <button className="mr-btn mr-btn-primary" onClick={() => setShowShortcutsModal(false)}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODALES DE OPERACIONES VISUALES PRE-LLM */}
      <ActionModals
        modal={activeActionModal}
        activeColumn={activeColumn}
        columns={columns}
        rows={currentDataRows}
        duplicateSummary={duplicateSummary}
        onClose={() => setActiveActionModal(null)}
        onPushStep={pushStep}
        onCreateBlankTable={handleCreateBlankTable}
      />

      {/* 8. WIZARD "OBTENER DATOS" ALINEADO A POWER BI */}
      <GetDataWizard
        initialTarget={getDataTarget}
        onClose={() => setGetDataTarget(null)}
        onTriggerLocalFilePicker={triggerFilePicker}
        onImportSnapshot={(snapshot, descriptor) => {
          openOrActivateSession(
            snapshot.sourceName,
            snapshot.columns,
            snapshot.rows,
            {
              delimiterLabel: snapshot.delimiterLabel,
              dedupedHeaders: 0,
            },
            undefined,
            descriptor
          );
        }}
      />

      {/* 9. MOTOR DUCKDB NATIVO (SIN WASM) */}
      <DuckDbModal
        open={showDuckDbModal}
        tableName={cleanTableName}
        columns={columns}
        rows={currentDataRows}
        activeColumn={activeColumn}
        onClose={() => setShowDuckDbModal(false)}
        onOpenQueryAsSession={(name, cols, rowsData) => {
          openOrActivateSession(name, cols, rowsData, {
            delimiterLabel: "DuckDB Native",
            dedupedHeaders: 0,
          });
        }}
        onPushStep={pushStep}
      />
    </div>
  );
}
