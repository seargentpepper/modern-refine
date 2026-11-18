import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Archive,
  CalendarCheck,
  CheckCircle2,
  Columns3,
  Download,
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
} from "lucide-react";
import { ROOT_CSV_TEMPLATES } from "./data/csvTemplates";
import {
  computeClusters,
  computeColumnDiagnostic,
  computeFacets,
  isLikelyDateColumn,
  parseCsvText,
  replayRecipeWithTrash,
  serializeCsv,
} from "./lib/refineEngine";
import type {
  ClusterMethod,
  DataRow,
  DateTargetFormat,
  FileIngestionMeta,
  RefineStep,
  TransformKind,
} from "./types/refine";

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DATE_FORMAT_LABELS: Record<DateTargetFormat, string> = {
  iso: "ISO AAAA-MM-DD (ej. 2025-01-14)",
  dmy_slash: "DD/MM/AAAA (ej. 14/01/2025)",
  ymd_slash: "AAAA/MM/DD (ej. 2025/01/14)",
  dmy_dash: "DD-MM-AAAA (ej. 14-01-2025)",
  mdy_slash: "MM/DD/AAAA (ej. 01/14/2025)",
  spanish_short: "DD-MMM-AAAA (ej. 14-ene-2025)",
  spanish_long: "Largo (14 de enero de 2025)",
};

export default function App() {
  const [fileName, setFileName] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [baseRows, setBaseRows] = useState<DataRow[]>([]);
  const [ingestionMeta, setIngestionMeta] = useState<FileIngestionMeta | null>(null);
  const [workbookRef, setWorkbookRef] = useState<XLSX.WorkBook | null>(null);
  const [clusterMethodFilter, setClusterMethodFilter] = useState<ClusterMethod | "ALL">("ALL");

  const [steps, setSteps] = useState<RefineStep[]>([]);
  const [redoStack, setRedoStack] = useState<RefineStep[]>([]);

  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [selectionMode, setSelectionMode] = useState<"column" | "cell">("column");
  const [dateFormat, setDateFormat] = useState<DateTargetFormat>("iso");

  const [leftTab, setLeftTab] = useState<"facets" | "clusters">("clusters");
  const [rightTab, setRightTab] = useState<"history" | "trash" | "recipe">("history");

  const [facetFilter, setFacetFilter] = useState<string | null>(null);
  const [filterAlias, setFilterAlias] = useState<string>("");
  const [isEditingFilterAlias, setIsEditingFilterAlias] = useState(false);

  const [renamingFacetValue, setRenamingFacetValue] = useState<string | null>(null);
  const [renameFacetDraft, setRenameFacetDraft] = useState<string>("");

  const [selectedCell, setSelectedCell] = useState<{ visibleIdx: number; colIdx: number } | null>(
    null
  );
  const [editingCell, setEditingCell] = useState<{ origIdx: number; col: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const [clusterTargets, setClusterTargets] = useState<Record<string, string>>({});
  const [clusterUnchecked, setClusterUnchecked] = useState<Record<string, Set<string>>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recipeInputRef = useRef<HTMLInputElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  const hasData = columns.length > 0;

  const { activeRows, trash } = useMemo(
    () => replayRecipeWithTrash(baseRows, steps),
    [baseRows, steps]
  );

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

  // Cuando la columna no tiene clústeres (ej. columna de fechas), mostrar Facetas automáticamente
  useEffect(() => {
    if (clusters.length === 0 && facets.length > 0) {
      setLeftTab("facets");
    } else if (clusters.length > 0) {
      setLeftTab("clusters");
    }
  }, [activeColumn, clusters.length, facets.length]);

  const visibleRows = useMemo(() => {
    if (facetFilter === null || !activeColumn) return activeRows;
    return activeRows.filter((item) => (item.data[activeColumn] ?? "") === facetFilter);
  }, [activeRows, facetFilter, activeColumn]);

  const handleClearSession = () => {
    setFileName("");
    setColumns([]);
    setBaseRows([]);
    setIngestionMeta(null);
    setWorkbookRef(null);
    setSteps([]);
    setRedoStack([]);
    setSelectedColumn("");
    setFacetFilter(null);
    setFilterAlias("");
    setSelectedCell(null);
    setEditingCell(null);
    setClusterTargets({});
    setClusterUnchecked({});
    setClusterMethodFilter("ALL");
  };

  const loadCsvIntoSession = (name: string, rawText: string) => {
    const parsed = parseCsvText(rawText);
    if (parsed.columns.length === 0) return;
    setFileName(name);
    setColumns(parsed.columns);
    setBaseRows(parsed.rows);
    setIngestionMeta(parsed.meta);
    setWorkbookRef(null);
    setSteps([]);
    setRedoStack([]);
    setSelectedColumn(parsed.columns[0]);
    setSelectionMode("column");
    setFacetFilter(null);
    setFilterAlias("");
    setSelectedCell(parsed.rows.length > 0 ? { visibleIdx: 0, colIdx: 0 } : null);
    setEditingCell(null);
    setClusterTargets({});
    setClusterUnchecked({});
    setClusterMethodFilter("ALL");
  };

  const loadWorkbookSheetIntoSession = (
    name: string,
    wb: XLSX.WorkBook,
    sheetName: string
  ) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    const parsed = parseCsvText(csvText);
    if (parsed.columns.length === 0) return;
    setFileName(name);
    setColumns(parsed.columns);
    setBaseRows(parsed.rows);
    setWorkbookRef(wb);
    setIngestionMeta({
      delimiterLabel: `Excel (${sheetName})`,
      dedupedHeaders: parsed.meta.dedupedHeaders,
      sheets: wb.SheetNames,
      activeSheet: sheetName,
    });
    setSteps([]);
    setRedoStack([]);
    setSelectedColumn(parsed.columns[0]);
    setSelectionMode("column");
    setFacetFilter(null);
    setFilterAlias("");
    setSelectedCell(parsed.rows.length > 0 ? { visibleIdx: 0, colIdx: 0 } : null);
    setEditingCell(null);
    setClusterTargets({});
    setClusterUnchecked({});
    setClusterMethodFilter("ALL");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", raw: false });
      const firstSheet = wb.SheetNames[0];
      if (firstSheet) {
        loadWorkbookSheetIntoSession(file.name, wb, firstSheet);
      }
    } else {
      const text = await file.text();
      loadCsvIntoSession(file.name, text);
    }
    e.target.value = "";
  };

  const handleExportXlsx = () => {
    if (!hasData) return;
    const ws = XLSX.utils.json_to_sheet(currentDataRows, { header: columns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, ingestionMeta?.activeSheet ?? "Limpio");
    const outName = fileName.replace(/\.(csv|tsv|xlsx|xls|ods)$/i, "") + "_limpio.xlsx";
    XLSX.writeFile(wb, outName);
  };

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
      setSteps(importedSteps);
      setRedoStack([]);
      setFacetFilter(null);
      setRightTab("history");
    } finally {
      e.target.value = "";
    }
  };

  const pushStep = (
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
    setSteps((prev) => [...prev, step]);
    setRedoStack([]);
    setFacetFilter(null);
    setFilterAlias("");
  };

  const handleStandardizeWholeColumnDates = (fmt: DateTargetFormat = dateFormat) => {
    if (!activeColumn) return;
    setSelectionMode("column");
    pushStep(
      "standardize_dates",
      activeColumn,
      `Homologar columna "${activeColumn}" → ${DATE_FORMAT_LABELS[fmt].split(" (")[0]}`,
      { format: fmt }
    );
  };

  const handleToggleStep = (stepId: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, enabled: !s.enabled } : s))
    );
    setFacetFilter(null);
  };

  const handleDeleteStep = (stepId: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    setFacetFilter(null);
  };

  const handleUndo = () => {
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    setSteps((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [last, ...prev]);
    setFacetFilter(null);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const [next, ...rest] = redoStack;
    setSteps((prev) => [...prev, next]);
    setRedoStack(rest);
    setFacetFilter(null);
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
    setSelectedCell((prev) =>
      prev
        ? {
            visibleIdx: Math.max(0, Math.min(prev.visibleIdx, visibleRows.length - 2)),
            colIdx: prev.colIdx,
          }
        : null
    );
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
        setSelectionMode("cell");
        setEditingCell({ origIdx: targetRow.origIdx, col: targetCol });
        setEditDraft(targetRow.data[targetCol] ?? "");
      }
      return;
    } else {
      return;
    }

    setSelectionMode("cell");
    setSelectedCell({ visibleIdx: nextRow, colIdx: nextCol });
    if (columns[nextCol]) {
      setSelectedColumn(columns[nextCol]);
    }
  };

  useEffect(() => {
    if (!selectedCell || selectionMode !== "cell" || !tableWrapRef.current) return;
    const cellEl = tableWrapRef.current.querySelector(
      `td[data-cell="${selectedCell.visibleIdx}-${selectedCell.colIdx}"]`
    );
    cellEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedCell, selectionMode]);

  const recipeJson = useMemo(
    () =>
      JSON.stringify(
        {
          schema: "modern-refine/v1",
          sourceFile: fileName,
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
    [fileName, steps]
  );

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
            <Archive size={16} color="#60a5fa" />
            ModernRefine
          </span>
          <span className="mr-badge">Estación ETL</span>
          <span className="mr-file-pill">
            {hasData
              ? `${fileName} · ${currentDataRows.length} filas${
                  ingestionMeta ? ` · ${ingestionMeta.delimiterLabel}` : ""
                }`
              : "Sin archivo cargado"}
          </span>
          {workbookRef && ingestionMeta?.sheets && ingestionMeta.sheets.length > 1 && (
            <select
              className="mr-date-select"
              style={{ flex: "none", width: 145, height: 26 }}
              value={ingestionMeta.activeSheet ?? ""}
              onChange={(e) =>
                loadWorkbookSheetIntoSession(fileName, workbookRef, e.target.value)
              }
              title="Cambiar hoja de cálculo del archivo Excel"
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
            accept=".csv,.tsv,.xlsx,.xls,.ods,text/csv"
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
          <button className="mr-btn" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Abrir CSV
          </button>

          {ROOT_CSV_TEMPLATES.length > 0 && (
            <select
              className="mr-date-select"
              style={{ flex: "none", width: 205, height: 28 }}
              value={ROOT_CSV_TEMPLATES.some((t) => t.name === fileName) ? fileName : ""}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  handleClearSession();
                  return;
                }
                const tpl = ROOT_CSV_TEMPLATES.find((t) => t.name === val);
                if (tpl) loadCsvIntoSession(tpl.name, tpl.content);
              }}
            >
              <option value="">
                {hasData
                  ? "— Cerrar tabla (Inicio limpio) —"
                  : `Plantillas CSV (${ROOT_CSV_TEMPLATES.length})`}
              </option>
              {ROOT_CSV_TEMPLATES.map((tpl) => (
                <option key={tpl.name} value={tpl.name}>
                  Plantilla: {tpl.name}
                </option>
              ))}
            </select>
          )}

          <button className="mr-btn" onClick={handleUndo} disabled={steps.length === 0}>
            <Undo2 size={14} /> Deshacer
          </button>
          <button className="mr-btn" onClick={handleRedo} disabled={redoStack.length === 0}>
            <Redo2 size={14} /> Rehacer
          </button>
          <button
            className="mr-btn"
            disabled={!hasData}
            onClick={() => recipeInputRef.current?.click()}
            title="Cargar archivo .refine.json previo"
          >
            <FolderInput size={14} /> Cargar Receta
          </button>
          <button
            className="mr-btn"
            disabled={!hasData}
            onClick={() =>
              downloadTextFile(
                fileName.replace(/\.csv$/i, "") + ".refine.json",
                recipeJson,
                "application/json"
              )
            }
          >
            <FileSpreadsheet size={14} /> Guardar Receta
          </button>
          <button
            className="mr-btn mr-btn-primary"
            disabled={!hasData}
            onClick={() =>
              downloadTextFile(
                fileName.replace(/\.(csv|tsv|xlsx|xls|ods)$/i, "") + "_limpio.csv",
                serializeCsv(columns, currentDataRows),
                "text/csv;charset=utf-8"
              )
            }
          >
            <Download size={14} /> Exportar CSV
          </button>
          <button
            className="mr-btn"
            disabled={!hasData}
            onClick={handleExportXlsx}
            title="Exportar directamente como libro Excel (.xlsx)"
          >
            <FileSpreadsheet size={14} /> Exportar XLSX
          </button>
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
                Abre un archivo CSV o elige una plantilla de la raíz para analizar sus facetas.
              </div>
            ) : (
              <>
                <select
                  className="mr-col-select"
                  value={activeColumn}
                  onChange={(e) => {
                    setSelectedColumn(e.target.value);
                    setSelectionMode("column");
                    setFacetFilter(null);
                    setFilterAlias("");
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

                {/* Controles de Texto y Limpieza en 1 Clic sobre toda la columna */}
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
                      pushStep("extract_numbers", activeColumn, `Extraer solo números (${activeColumn})`)
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
                  <button
                    className="mr-op-btn"
                    onClick={() =>
                      pushStep(
                        "split_keep_left",
                        activeColumn,
                        `Separar por "-" (conservar izquierda en ${activeColumn})`,
                        { separator: "-" }
                      )
                    }
                    title="Conserva la parte izquierda antes del guion"
                  >
                    Separar izq (-)
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
                </div>

                {/* Homologación Masiva: EXCLUSIVA cuando la columna seleccionada es de Fecha */}
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
                            onChange={(e) => setFilterAlias(e.target.value)}
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
                            onClick={() => {
                              setFacetFilter(null);
                              setFilterAlias("");
                            }}
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
                            setFacetFilter(facetFilter === f.value ? null : f.value);
                            setFilterAlias("");
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

        {/* ZONE 2: Editable Table with Whole-Column Selection */}
        <main className="mr-zone mr-zone-center">
          <div className="mr-table-bar">
            <span style={{ fontWeight: 600 }}>
              {hasData
                ? `Vista de Tabla · ${visibleRows.length} de ${currentDataRows.length} filas`
                : "Vista de Tabla"}
            </span>
            <div className="mr-actions">
              {hasData && (
                <button
                  className="mr-btn"
                  onClick={() => setSelectionMode("column")}
                  title="Seleccionar todas las celdas de la columna actual"
                >
                  <Columns3 size={13} /> Seleccionar columna "{activeColumn}"
                </button>
              )}
              {trash.length > 0 && (
                <button
                  className="mr-btn"
                  onClick={() => setRightTab("trash")}
                  title="Ver filas descartadas o restaurarlas"
                >
                  <Trash2 size={13} /> Papelera ({trash.length})
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

          {/* Barra contextual de reformateo de fecha: EXCLUSIVA al seleccionar una columna de fecha */}
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
                <Archive size={32} color="#60a5fa" style={{ marginBottom: 8 }} />
                <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>
                  Listo para limpiar tus datos
                </h2>
                <p style={{ margin: "0 0 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Inicia abriendo un archivo <code>.csv</code> desde tu equipo o prueba con una de
                  las plantillas ubicadas en la raíz del proyecto.
                </p>

                <button
                  className="mr-btn mr-btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> Abrir archivo CSV
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
                            setSelectedColumn(col);
                            setSelectionMode("column");
                            setFacetFilter(null);
                            setSelectedCell((prev) => ({
                              visibleIdx: prev?.visibleIdx ?? 0,
                              colIdx,
                            }));
                          }}
                        >
                          {col} {isFullColSelected ? "✓" : ""}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ origIdx, data }, visibleIdx) => {
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
                                setSelectionMode("cell");
                                setSelectedCell({ visibleIdx, colIdx });
                                setSelectedColumn(col);
                                tableWrapRef.current?.focus();
                              }}
                              onDoubleClick={() => {
                                setSelectionMode("cell");
                                setSelectedCell({ visibleIdx, colIdx });
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

        {/* ZONE 3: History, Trash & JSON Recipe */}
        <aside className="mr-zone mr-zone-right">
          <div className="mr-zone-header">
            <span>
              <History size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Historial y Papelera
            </span>
          </div>

          <div className="mr-scroll">
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
                Papelera ({trash.length})
              </button>
              <button
                className={`mr-tab ${rightTab === "recipe" ? "active" : ""}`}
                onClick={() => setRightTab("recipe")}
              >
                Receta
              </button>
            </div>

            {rightTab === "history" &&
              (steps.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                  Aún no aplicas cambios. Puedes activar, desactivar o eliminar cada paso de forma
                  aislada.
                </div>
              ) : (
                steps.map((step, i) => (
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
                          <div className="mr-step-num">Paso {i + 1}</div>
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
                ))
              ))}

            {rightTab === "trash" &&
              (trash.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "12px 4px" }}>
                  No hay filas eliminadas en esta sesión.
                </div>
              ) : (
                <div>
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
                    <RotateCcw size={13} /> Restaurar todas ({trash.length})
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
                </div>
              ))}

            {rightTab === "recipe" && <pre className="mr-recipe-pre">{recipeJson}</pre>}
          </div>
        </aside>
      </div>
    </div>
  );
}
