import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  applyExtractText,
  applyReplaceValue,
  splitFlexibleParts,
} from "../lib/refineEngine";
import type { DataRow, DuplicateSummary, TransformKind } from "../types/refine";

export type ActiveActionModal =
  | "replace"
  | "dedupe"
  | "split"
  | "merge"
  | "extract"
  | "unpivot"
  | "new_table"
  | null;

interface ActionModalsProps {
  modal: ActiveActionModal;
  activeColumn: string;
  columns: string[];
  rows: DataRow[];
  duplicateSummary: DuplicateSummary | null;
  onClose: () => void;
  onPushStep: (
    kind: TransformKind,
    column: string,
    label: string,
    params?: Record<string, unknown>
  ) => void;
  onCreateBlankTable?: (tableName: string, cols: string[], rowCount: number) => void;
}

export function ActionModals({
  modal,
  activeColumn,
  columns,
  rows,
  duplicateSummary,
  onClose,
  onPushStep,
  onCreateBlankTable,
}: ActionModalsProps) {
  // 1. Replace state
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchMode, setMatchMode] = useState<"exact" | "contains" | "regex">("contains");
  const [caseSensitive, setCaseSensitive] = useState(false);

  // 2. Dedupe state
  const [dedupeScope, setDedupeScope] = useState<"column" | "row">("column");
  const [dedupeKeep, setDedupeKeep] = useState<"first" | "last">("first");

  // 3. Split flexible state
  const [splitMode, setSplitMode] = useState<"delimiter" | "length">("delimiter");
  const [splitDelimiter, setSplitDelimiter] = useState(",");
  const [splitMaxParts, setSplitMaxParts] = useState(2);
  const [splitLength, setSplitLength] = useState(4);

  // 4. Merge columns state
  const [mergeSelectedCols, setMergeSelectedCols] = useState<string[]>(() =>
    columns.slice(0, Math.min(2, columns.length))
  );
  const [mergeSeparator, setMergeSeparator] = useState(" ");
  const [mergeTargetName, setMergeTargetName] = useState("");
  const [mergeHideSources, setMergeHideSources] = useState(false);

  // 5. Extract text state
  const [extractMode, setExtractMode] = useState<
    "before" | "after" | "between" | "first_n" | "last_n"
  >("before");
  const [extractDelim, setExtractDelim] = useState("-");
  const [extractEndDelim, setExtractEndDelim] = useState("-");
  const [extractCount, setExtractCount] = useState(4);

  // 6. Unpivot state
  const [unpivotCols, setUnpivotCols] = useState<string[]>(() =>
    columns.length > 1 ? columns.slice(-Math.min(3, columns.length - 1)) : []
  );
  const [unpivotAttrCol, setUnpivotAttrCol] = useState("Periodo");
  const [unpivotValCol, setUnpivotValCol] = useState("Valor");

  // 7. New blank table state
  const [newTableName, setNewTableName] = useState("Tabla_Nueva");
  const [newTableColsRaw, setNewTableColsRaw] = useState("ID, Nombre, Categoria, Valor");
  const [newTableRowsCount, setNewTableRowsCount] = useState(10);

  const replacePreview = useMemo(() => {
    if (modal !== "replace" || !findText) return { affected: 0, samples: [] as Array<{ before: string; after: string }> };
    let affected = 0;
    const samples: Array<{ before: string; after: string }> = [];
    for (const r of rows) {
      const before = r[activeColumn] ?? "";
      const after = applyReplaceValue(before, {
        find: findText,
        replace: replaceText,
        matchMode,
        caseSensitive,
      });
      if (after !== before) {
        affected++;
        if (samples.length < 5) samples.push({ before, after });
      }
    }
    return { affected, samples };
  }, [modal, rows, activeColumn, findText, replaceText, matchMode, caseSensitive]);

  const splitPreview = useMemo(() => {
    if (modal !== "split") return [];
    return rows
      .filter((r) => (r[activeColumn] ?? "").trim() !== "")
      .slice(0, 4)
      .map((r) => ({
        before: r[activeColumn] ?? "",
        parts: splitFlexibleParts(r[activeColumn] ?? "", {
          mode: splitMode,
          delimiter: splitDelimiter,
          maxParts: splitMaxParts,
          length: splitLength,
        }),
      }));
  }, [modal, rows, activeColumn, splitMode, splitDelimiter, splitMaxParts, splitLength]);

  const extractPreview = useMemo(() => {
    if (modal !== "extract") return [];
    return rows
      .filter((r) => (r[activeColumn] ?? "").trim() !== "")
      .slice(0, 5)
      .map((r) => {
        const before = r[activeColumn] ?? "";
        return {
          before,
          after: applyExtractText(before, {
            mode: extractMode,
            delimiter: extractDelim,
            endDelimiter: extractEndDelim,
            count: extractCount,
          }),
        };
      });
  }, [modal, rows, activeColumn, extractMode, extractDelim, extractEndDelim, extractCount]);

  if (!modal) return null;

  const titles: Record<Exclude<ActiveActionModal, null>, string> = {
    replace: `Buscar y Reemplazar — ${activeColumn}`,
    dedupe: "Quitar Filas Duplicadas",
    split: `Dividir Columna Flexible — ${activeColumn}`,
    merge: "Combinar / Fusionar Columnas",
    extract: `Extraer Texto — ${activeColumn}`,
    unpivot: "Unpivot (Columnas a Filas)",
    new_table: "Crear Nueva Tabla en Blanco",
  };

  return (
    <div className="mr-dialog-overlay" onClick={onClose}>
      <div className="mr-dialog mr-action-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mr-dialog-header">
          <span>{titles[modal]}</span>
          <button className="mr-pane-collapse-btn" onClick={onClose} title="Cerrar (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="mr-dialog-body">
          {/* 1. BUSCAR Y REEMPLAZAR */}
          {modal === "replace" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Valor a buscar en "{activeColumn}"</label>
                <input
                  className="mr-cell-input"
                  autoFocus
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Ej. N/A, Cd., México..."
                />
              </div>
              <div className="mr-modal-field">
                <label>Reemplazar por</label>
                <input
                  className="mr-cell-input"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Dejar vacío para borrar coincidencia"
                />
              </div>
              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Modo de coincidencia</label>
                  <select
                    className="mr-date-select"
                    value={matchMode}
                    onChange={(e) =>
                      setMatchMode(e.target.value as "exact" | "contains" | "regex")
                    }
                  >
                    <option value="contains">Parcial (contiene)</option>
                    <option value="exact">Celda exacta</option>
                    <option value="regex">Expresión regular (Regex)</option>
                  </select>
                </div>
                <label className="mr-modal-check">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                  />
                  Distinguir MAYÚS/minús
                </label>
              </div>

              {findText && (
                <div className="mr-modal-preview">
                  <div className="mr-modal-preview-title">
                    Celdas afectadas: <strong>{replacePreview.affected}</strong>
                  </div>
                  {replacePreview.samples.map((s, idx) => (
                    <div key={idx} className="mr-modal-preview-row">
                      <span>{s.before}</span>
                      <span>→</span>
                      <strong>{s.after || "∅"}</strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={!findText}
                  onClick={() => {
                    onPushStep(
                      "replace_value",
                      activeColumn,
                      `Reemplazar "${findText}" → "${replaceText}" (${activeColumn})`,
                      {
                        find: findText,
                        replace: replaceText,
                        matchMode,
                        caseSensitive,
                      }
                    );
                    onClose();
                  }}
                >
                  Aplicar reemplazo ({replacePreview.affected})
                </button>
              </div>
            </div>
          )}

          {/* 2. QUITAR DUPLICADOS */}
          {modal === "dedupe" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Alcance de deduplicación</label>
                <select
                  className="mr-date-select"
                  value={dedupeScope}
                  onChange={(e) => setDedupeScope(e.target.value as "column" | "row")}
                >
                  <option value="column">
                    Por columna clave "{activeColumn}" ({duplicateSummary?.duplicateColumnRows ?? 0}{" "}
                    duplicadas)
                  </option>
                  <option value="row">
                    Por fila 100% idéntica ({duplicateSummary?.exactRowDuplicates ?? 0} duplicadas)
                  </option>
                </select>
              </div>
              <div className="mr-modal-field">
                <label>Qué registro conservar</label>
                <select
                  className="mr-date-select"
                  value={dedupeKeep}
                  onChange={(e) => setDedupeKeep(e.target.value as "first" | "last")}
                >
                  <option value="first">Conservar primera aparición</option>
                  <option value="last">Conservar última aparición</option>
                </select>
              </div>
              <div className="mr-modal-preview">
                <div className="mr-modal-preview-title">
                  Se enviarán a la Papelera (recuperables):{" "}
                  <strong>
                    {dedupeScope === "column"
                      ? duplicateSummary?.duplicateColumnRows ?? 0
                      : duplicateSummary?.exactRowDuplicates ?? 0}
                  </strong>{" "}
                  filas.
                </div>
              </div>
              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  onClick={() => {
                    const count =
                      dedupeScope === "column"
                        ? duplicateSummary?.duplicateColumnRows ?? 0
                        : duplicateSummary?.exactRowDuplicates ?? 0;
                    const label =
                      dedupeScope === "row"
                        ? `Quitar ${count} filas idénticas (${dedupeKeep === "first" ? "1ª" : "última"})`
                        : `Quitar duplicados en "${activeColumn}" (${dedupeKeep === "first" ? "1ª" : "última"})`;
                    onPushStep("remove_duplicates", activeColumn, label, {
                      scope: dedupeScope,
                      keep: dedupeKeep,
                    });
                    onClose();
                  }}
                >
                  Quitar duplicados
                </button>
              </div>
            </div>
          )}

          {/* 3. DIVIDIR COLUMNA FLEXIBLE */}
          {modal === "split" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Dividir por</label>
                  <select
                    className="mr-date-select"
                    value={splitMode}
                    onChange={(e) => setSplitMode(e.target.value as "delimiter" | "length")}
                  >
                    <option value="delimiter">Delimitador libre</option>
                    <option value="length">Número fijo de caracteres</option>
                  </select>
                </div>
                {splitMode === "delimiter" ? (
                  <>
                    <div className="mr-modal-field" style={{ width: 110 }}>
                      <label>Delimitador</label>
                      <input
                        className="mr-cell-input"
                        value={splitDelimiter}
                        onChange={(e) => setSplitDelimiter(e.target.value)}
                      />
                    </div>
                    <div className="mr-modal-field" style={{ width: 95 }}>
                      <label>Máx. partes</label>
                      <input
                        type="number"
                        min={2}
                        max={12}
                        className="mr-cell-input"
                        value={splitMaxParts}
                        onChange={(e) => setSplitMaxParts(Math.max(2, Number(e.target.value) || 2))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mr-modal-field" style={{ width: 130 }}>
                    <label>Cada N caracteres</label>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      className="mr-cell-input"
                      value={splitLength}
                      onChange={(e) => setSplitLength(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                )}
              </div>

              <div className="mr-modal-preview">
                <div className="mr-modal-preview-title">Vista previa de división:</div>
                {splitPreview.map((item, i) => (
                  <div key={i} className="mr-modal-preview-row">
                    <span>{item.before}</span>
                    <span>→</span>
                    <strong>{item.parts.join(" | ")}</strong>
                  </div>
                ))}
              </div>

              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  onClick={() => {
                    onPushStep(
                      "split_column_flexible",
                      activeColumn,
                      splitMode === "delimiter"
                        ? `Dividir "${activeColumn}" por "${splitDelimiter}"`
                        : `Dividir "${activeColumn}" cada ${splitLength} caracteres`,
                      {
                        mode: splitMode,
                        delimiter: splitDelimiter,
                        maxParts: splitMaxParts,
                        length: splitLength,
                      }
                    );
                    onClose();
                  }}
                >
                  Dividir columna
                </button>
              </div>
            </div>
          )}

          {/* 4. COMBINAR COLUMNAS */}
          {modal === "merge" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Selecciona 2 o más columnas en orden</label>
                <div className="mr-col-checklist">
                  {columns.map((col) => {
                    const checked = mergeSelectedCols.includes(col);
                    return (
                      <label key={col} className="mr-col-check-pill">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setMergeSelectedCols((prev) =>
                              checked ? prev.filter((c) => c !== col) : [...prev, col]
                            )
                          }
                        />
                        <span>{col}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ width: 130 }}>
                  <label>Separador</label>
                  <input
                    className="mr-cell-input"
                    value={mergeSeparator}
                    onChange={(e) => setMergeSeparator(e.target.value)}
                    placeholder='Ej. " ", ", ", "-"'
                  />
                </div>
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Nombre de nueva columna</label>
                  <input
                    className="mr-cell-input"
                    value={mergeTargetName}
                    onChange={(e) => setMergeTargetName(e.target.value)}
                    placeholder={mergeSelectedCols.join("_") || "Columna_Combinada"}
                  />
                </div>
              </div>

              <label className="mr-modal-check">
                <input
                  type="checkbox"
                  checked={mergeHideSources}
                  onChange={(e) => setMergeHideSources(e.target.checked)}
                />
                Ocultar columnas originales (recuperables en Papelera)
              </label>

              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={mergeSelectedCols.length < 2}
                  onClick={() => {
                    const target =
                      mergeTargetName.trim() || mergeSelectedCols.join("_");
                    onPushStep(
                      "merge_columns",
                      mergeSelectedCols[0],
                      `Combinar ${mergeSelectedCols.join(" + ")} → "${target}"`,
                      {
                        sourceColumns: mergeSelectedCols,
                        separator: mergeSeparator,
                        targetColumn: target,
                        hideSources: mergeHideSources,
                      }
                    );
                    onClose();
                  }}
                >
                  Combinar ({mergeSelectedCols.length} cols)
                </button>
              </div>
            </div>
          )}

          {/* 5. EXTRAER TEXTO */}
          {modal === "extract" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Regla de extracción en "{activeColumn}"</label>
                <select
                  className="mr-date-select"
                  value={extractMode}
                  onChange={(e) =>
                    setExtractMode(
                      e.target.value as "before" | "after" | "between" | "first_n" | "last_n"
                    )
                  }
                >
                  <option value="before">Texto antes del delimitador</option>
                  <option value="after">Texto después del delimitador</option>
                  <option value="between">Texto entre dos delimitadores</option>
                  <option value="first_n">Primeros N caracteres</option>
                  <option value="last_n">Últimos N caracteres</option>
                </select>
              </div>

              {extractMode === "first_n" || extractMode === "last_n" ? (
                <div className="mr-modal-field">
                  <label>Cantidad de caracteres (N)</label>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    className="mr-cell-input"
                    value={extractCount}
                    onChange={(e) => setExtractCount(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              ) : (
                <div className="mr-modal-row">
                  <div className="mr-modal-field" style={{ flex: 1 }}>
                    <label>{extractMode === "between" ? "Delimitador inicial" : "Delimitador"}</label>
                    <input
                      className="mr-cell-input"
                      value={extractDelim}
                      onChange={(e) => setExtractDelim(e.target.value)}
                    />
                  </div>
                  {extractMode === "between" && (
                    <div className="mr-modal-field" style={{ flex: 1 }}>
                      <label>Delimitador final</label>
                      <input
                        className="mr-cell-input"
                        value={extractEndDelim}
                        onChange={(e) => setExtractEndDelim(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mr-modal-preview">
                <div className="mr-modal-preview-title">Vista previa (5 filas):</div>
                {extractPreview.map((item, i) => (
                  <div key={i} className="mr-modal-preview-row">
                    <span>{item.before}</span>
                    <span>→</span>
                    <strong>{item.after || "∅"}</strong>
                  </div>
                ))}
              </div>

              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  onClick={() => {
                    onPushStep(
                      "extract_text",
                      activeColumn,
                      `Extraer texto (${extractMode}) en "${activeColumn}"`,
                      {
                        mode: extractMode,
                        delimiter: extractDelim,
                        endDelimiter: extractEndDelim,
                        count: extractCount,
                      }
                    );
                    onClose();
                  }}
                >
                  Aplicar extracción
                </button>
              </div>
            </div>
          )}

          {/* 6. UNPIVOT */}
          {modal === "unpivot" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Columnas a convertir en filas (Unpivot)</label>
                <div className="mr-col-checklist">
                  {columns.map((col) => {
                    const checked = unpivotCols.includes(col);
                    return (
                      <label key={col} className="mr-col-check-pill">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setUnpivotCols((prev) =>
                              checked ? prev.filter((c) => c !== col) : [...prev, col]
                            )
                          }
                        />
                        <span>{col}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Columna de Atributo</label>
                  <input
                    className="mr-cell-input"
                    value={unpivotAttrCol}
                    onChange={(e) => setUnpivotAttrCol(e.target.value)}
                  />
                </div>
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Columna de Valor</label>
                  <input
                    className="mr-cell-input"
                    value={unpivotValCol}
                    onChange={(e) => setUnpivotValCol(e.target.value)}
                  />
                </div>
              </div>

              <div className="mr-modal-preview">
                <div className="mr-modal-preview-title">
                  De {rows.length} filas × {unpivotCols.length} columnas →{" "}
                  <strong>{rows.length * unpivotCols.length}</strong> filas resultantes.
                </div>
              </div>

              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={unpivotCols.length === 0 || unpivotCols.length >= columns.length}
                  onClick={() => {
                    onPushStep(
                      "unpivot_columns",
                      unpivotCols[0],
                      `Unpivot de ${unpivotCols.length} columnas → (${unpivotAttrCol}, ${unpivotValCol})`,
                      {
                        columnsToUnpivot: unpivotCols,
                        attributeColumn: unpivotAttrCol,
                        valueColumn: unpivotValCol,
                      }
                    );
                    onClose();
                  }}
                >
                  Ejecutar Unpivot
                </button>
              </div>
            </div>
          )}

          {/* 7. NUEVA TABLA EN BLANCO */}
          {modal === "new_table" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-field">
                <label>Nombre de la tabla</label>
                <input
                  className="mr-cell-input"
                  autoFocus
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="Tabla_Nueva"
                />
              </div>
              <div className="mr-modal-field">
                <label>Columnas iniciales (separadas por coma)</label>
                <input
                  className="mr-cell-input"
                  value={newTableColsRaw}
                  onChange={(e) => setNewTableColsRaw(e.target.value)}
                  placeholder="ID, Nombre, Ciudad, Monto"
                />
              </div>
              <div className="mr-modal-field" style={{ width: 150 }}>
                <label>Filas iniciales en blanco</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  className="mr-cell-input"
                  value={newTableRowsCount}
                  onChange={(e) =>
                    setNewTableRowsCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))
                  }
                />
              </div>
              <div className="mr-modal-preview">
                <div className="mr-modal-preview-title">
                  Se abrirá una pestaña editable lista para capturar celdas, añadir filas/columnas y
                  aplicar fórmulas o facetas.
                </div>
              </div>
              <div className="mr-dialog-footer">
                <button type="button" className="mr-btn" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  onClick={() => {
                    const parsedCols = newTableColsRaw
                      .split(",")
                      .map((c) => c.trim())
                      .filter(Boolean);
                    const finalCols =
                      parsedCols.length > 0 ? Array.from(new Set(parsedCols)) : ["Columna_1", "Columna_2", "Columna_3"];
                    onCreateBlankTable?.(
                      newTableName.trim() || "Tabla_Nueva",
                      finalCols,
                      newTableRowsCount
                    );
                    onClose();
                  }}
                >
                  Crear tabla
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
