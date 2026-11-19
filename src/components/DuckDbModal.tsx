import { useEffect, useMemo, useState } from "react";
import { Database, Download, Play, PlusSquare, Sparkles, X } from "lucide-react";
import {
  evaluateWindowMagicBridge,
  exportParquetWithDialogBridge,
  getDuckDbStatusBridge,
  groupByDuckDbBridge,
  queryDuckDbBridge,
  syncDuckDbSessionBridge,
} from "../lib/tauriBridge";
import type { DataRow, DuckDbStatus, DuckQueryResult, TransformKind } from "../types/refine";

interface DuckDbModalProps {
  open: boolean;
  tableName: string;
  columns: string[];
  rows: DataRow[];
  activeColumn: string;
  onClose: () => void;
  onOpenQueryAsSession: (name: string, cols: string[], rows: DataRow[]) => void;
  onPushStep: (
    kind: TransformKind,
    column: string,
    label: string,
    params?: Record<string, unknown>
  ) => void;
}

function sanitizeDuckTableName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "tabla_activa";
  return /^\d/.test(cleaned) ? `t_${cleaned}` : cleaned;
}

export function DuckDbModal({
  open,
  tableName,
  columns,
  rows,
  activeColumn,
  onClose,
  onOpenQueryAsSession,
  onPushStep,
}: DuckDbModalProps) {
  const [tab, setTab] = useState<"sql" | "groupby" | "window">("sql");
  const [status, setStatus] = useState<DuckDbStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const safeTable = useMemo(() => sanitizeDuckTableName(tableName), [tableName]);

  const [sqlText, setSqlText] = useState("");
  const [queryResult, setQueryResult] = useState<DuckQueryResult | null>(null);

  const [groupCol, setGroupCol] = useState(activeColumn || columns[0] || "");
  const [valueCol, setValueCol] = useState(columns[columns.length - 1] || columns[0] || "");
  const [aggFn, setAggFn] = useState<"COUNT" | "SUM" | "AVG" | "MIN" | "MAX">("SUM");

  const [magicFn, setMagicFn] = useState<
    "RUNNING_SUM" | "PCT_OF_TOTAL" | "GROUP_AVG" | "ROW_NUM" | "IS_OUTLIER"
  >("RUNNING_SUM");
  const [magicValCol, setMagicValCol] = useState(activeColumn || columns[0] || "");
  const [magicPartCol, setMagicPartCol] = useState("");
  const [magicTargetCol, setMagicTargetCol] = useState("");

  useEffect(() => {
    if (!open) return;
    setSqlText(`SELECT * EXCLUDE ("__orig_idx") FROM "${safeTable}" LIMIT 100`);
    setGroupCol(activeColumn || columns[0] || "");
    setValueCol(columns[columns.length - 1] || columns[0] || "");
    setMagicValCol(activeColumn || columns[0] || "");
    setQueryResult(null);
    setErrorMsg(null);
    setInfoMsg(null);

    let cancelled = false;
    (async () => {
      const st = await getDuckDbStatusBridge();
      if (cancelled) return;
      setStatus(st);
      if (st.available && columns.length > 0) {
        try {
          const synced = await syncDuckDbSessionBridge(safeTable, columns, rows);
          if (!cancelled) setStatus(synced);
        } catch (err) {
          if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, safeTable, columns, rows, activeColumn]);

  if (!open) return null;

  const handleRunSql = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await syncDuckDbSessionBridge(safeTable, columns, rows);
      const res = await queryDuckDbBridge(sqlText, 500);
      setQueryResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunGroupBy = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await groupByDuckDbBridge(safeTable, columns, rows, groupCol, valueCol, aggFn);
      setQueryResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyWindowMagic = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const values = await evaluateWindowMagicBridge(
        safeTable,
        columns,
        rows,
        magicFn,
        magicValCol,
        magicPartCol || undefined
      );
      const targetName = magicTargetCol.trim() || `${magicValCol}_${magicFn}`;
      onPushStep(
        "computed_column",
        magicValCol,
        `DuckDB ${magicFn}(${magicValCol}) → "${targetName}"`,
        {
          targetColumn: targetName,
          fnName: magicFn,
          values,
        }
      );
      setInfoMsg(`Columna "${targetName}" calculada con DuckDB Nativo e insertada en la tabla.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExportParquet = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await exportParquetWithDialogBridge(safeTable, safeTable, columns, rows);
      if (res.status === "saved") {
        setInfoMsg(`Archivo Parquet guardado en: ${res.path}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mr-dialog-overlay" onClick={onClose}>
      <div className="mr-dialog mr-getdata-dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="mr-dialog-header">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Database size={16} style={{ color: "var(--mr-accent)" }} />
            Motor DuckDB Nativo (Sin WASM)
          </span>
          <button className="mr-pane-collapse-btn" onClick={onClose} title="Cerrar (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="mr-dialog-body">
          {/* Status bar del motor */}
          <div className="mr-duckdb-status-bar">
            <span>
              <strong>Motor:</strong> {status?.engine ?? "Verificando..."}
            </span>
            <span>
              <strong>Versión:</strong> {status?.version ?? "..."}
            </span>
            <span>
              <strong>Tabla en memoria C++:</strong> <code>{safeTable}</code> ({rows.length} filas)
            </span>
          </div>

          {!status?.available && (
            <div className="mr-formula-error" style={{ marginBottom: 10 }}>
              Estándar nativo sin WASM: estás en el preview de navegador web (<code>localhost:5174</code>).
              Para ejecutar consultas DuckDB nativas, Group By y exportación Parquet, abre la app con{" "}
              <code>npm run dev:desktop</code>.
            </div>
          )}

          {/* Selector de pestañas DuckDB */}
          <div className="mr-tabs-3" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className={`mr-tab ${tab === "sql" ? "active" : ""}`}
              onClick={() => setTab("sql")}
            >
              Consulta SQL
            </button>
            <button
              type="button"
              className={`mr-tab ${tab === "groupby" ? "active" : ""}`}
              onClick={() => setTab("groupby")}
            >
              Agrupar por (Group By)
            </button>
            <button
              type="button"
              className={`mr-tab ${tab === "window" ? "active" : ""}`}
              onClick={() => setTab("window")}
            >
              Fórmulas Mágicas (Ventana)
            </button>
          </div>

          {tab === "sql" && (
            <div className="mr-modal-stack">
              <textarea
                className="mr-sql-textarea"
                rows={4}
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={busy || !status?.available}
                  onClick={() => void handleRunSql()}
                >
                  <Play size={13} /> Ejecutar SQL en DuckDB
                </button>
                {queryResult && (
                  <span style={{ fontSize: 11.5, color: "var(--mr-text-muted)" }}>
                    {queryResult.rowCount} filas en <strong>{queryResult.elapsedMs} ms</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {tab === "groupby" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Agrupar por</label>
                  <select
                    className="mr-date-select"
                    value={groupCol}
                    onChange={(e) => setGroupCol(e.target.value)}
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Columna métrica</label>
                  <select
                    className="mr-date-select"
                    value={valueCol}
                    onChange={(e) => setValueCol(e.target.value)}
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mr-modal-field" style={{ width: 130 }}>
                  <label>Operación</label>
                  <select
                    className="mr-date-select"
                    value={aggFn}
                    onChange={(e) =>
                      setAggFn(e.target.value as "COUNT" | "SUM" | "AVG" | "MIN" | "MAX")
                    }
                  >
                    <option value="SUM">Suma (SUM)</option>
                    <option value="COUNT">Conteo (COUNT)</option>
                    <option value="AVG">Promedio (AVG)</option>
                    <option value="MIN">Mínimo (MIN)</option>
                    <option value="MAX">Máximo (MAX)</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={busy || !status?.available}
                  onClick={() => void handleRunGroupBy()}
                >
                  <Play size={13} /> Calcular
                </button>
              </div>
            </div>
          )}

          {tab === "window" && (
            <div className="mr-modal-stack">
              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Función mágica (DuckDB Native)</label>
                  <select
                    className="mr-date-select"
                    value={magicFn}
                    onChange={(e) =>
                      setMagicFn(
                        e.target.value as
                          | "RUNNING_SUM"
                          | "PCT_OF_TOTAL"
                          | "GROUP_AVG"
                          | "ROW_NUM"
                          | "IS_OUTLIER"
                      )
                    }
                  >
                    <option value="RUNNING_SUM">RUNNING_SUM — Suma acumulada</option>
                    <option value="PCT_OF_TOTAL">PCT_OF_TOTAL — % sobre el total</option>
                    <option value="GROUP_AVG">GROUP_AVG — Promedio por grupo</option>
                    <option value="ROW_NUM">ROW_NUM — Numerar filas por grupo</option>
                    <option value="IS_OUTLIER">IS_OUTLIER — Detectar atípicos (&gt;2σ)</option>
                  </select>
                </div>
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Columna objetivo</label>
                  <select
                    className="mr-date-select"
                    value={magicValCol}
                    onChange={(e) => setMagicValCol(e.target.value)}
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mr-modal-row">
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Particionar por (opcional, ej. Ciudad/Estado)</label>
                  <select
                    className="mr-date-select"
                    value={magicPartCol}
                    onChange={(e) => setMagicPartCol(e.target.value)}
                  >
                    <option value="">(Toda la tabla)</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mr-modal-field" style={{ flex: 1 }}>
                  <label>Nombre de nueva columna</label>
                  <input
                    className="mr-cell-input"
                    value={magicTargetCol}
                    onChange={(e) => setMagicTargetCol(e.target.value)}
                    placeholder={`${magicValCol}_${magicFn}`}
                  />
                </div>
                <button
                  type="button"
                  className="mr-btn mr-btn-primary"
                  disabled={busy || !status?.available}
                  onClick={() => void handleApplyWindowMagic()}
                >
                  <Sparkles size={13} /> Aplicar a la tabla
                </button>
              </div>
            </div>
          )}

          {errorMsg && <div className="mr-formula-error" style={{ marginTop: 10 }}>⚠ {errorMsg}</div>}
          {infoMsg && (
            <div className="mr-duckdb-info" style={{ marginTop: 10 }}>
              ✓ {infoMsg}
            </div>
          )}

          {queryResult && (tab === "sql" || tab === "groupby") && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  Resultado ({queryResult.rowCount} filas · {queryResult.elapsedMs} ms)
                </span>
                <button
                  type="button"
                  className="mr-btn"
                  disabled={queryResult.columns.length === 0}
                  onClick={() => {
                    onOpenQueryAsSession(
                      `${safeTable}_${tab === "groupby" ? "resumen" : "sql"}.csv`,
                      queryResult.columns,
                      queryResult.rows
                    );
                    onClose();
                  }}
                >
                  <PlusSquare size={13} /> Abrir resultado en nueva pestaña
                </button>
              </div>
              <div className="mr-navigator-table-wrap" style={{ maxHeight: 230 }}>
                <table className="mr-table">
                  <thead>
                    <tr>
                      {queryResult.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.slice(0, 100).map((r, idx) => (
                      <tr key={idx}>
                        {queryResult.columns.map((c) => (
                          <td key={c}>{r[c] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="mr-dialog-footer" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            className="mr-btn"
            disabled={busy || !status?.available || columns.length === 0}
            onClick={() => void handleExportParquet()}
            title="Exporta la tabla activa limpia directamente a formato Apache Parquet vía DuckDB Nativo"
          >
            <Download size={13} /> Exportar Parquet (.parquet)
          </button>
          <button type="button" className="mr-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
