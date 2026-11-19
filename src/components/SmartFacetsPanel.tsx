import { useState } from "react";
import { Eraser, Pencil, Sparkles, Trash2 } from "lucide-react";
import type {
  CellInferredType,
  ColumnDataType,
  ColumnQualityProfile,
  DuplicateSummary,
  FacetItem,
  FacetMode,
  NumericRangeProfile,
  QualityFilterKind,
  TimelineBucket,
  TransformKind,
} from "../types/refine";

interface SmartFacetsPanelProps {
  activeColumn: string;
  isDateCol: boolean;
  qualityProfile: ColumnQualityProfile | null;
  duplicateSummary: DuplicateSummary | null;
  numericRangeProfile: NumericRangeProfile | null;
  timelineBuckets: TimelineBucket[];
  facets: FacetItem[];
  facetFilter: string | null;
  qualityFilter: QualityFilterKind | null;
  typeFilter: CellInferredType | null;
  duplicateFilter: "all" | "duplicates" | "unique";
  numericRangeFilter: { min: number; max: number } | null;
  timelinePeriodFilter: string | null;
  filterAlias: string;
  isEditingFilterAlias: boolean;
  renamingFacetValue: string | null;
  renameFacetDraft: string;
  onSetIsEditingFilterAlias: (v: boolean) => void;
  onSetFilterAlias: (v: string) => void;
  onSetFacetFilter: (val: string | null) => void;
  onSetTypeFilter: (val: CellInferredType | null) => void;
  onSetDuplicateFilter: (val: "all" | "duplicates" | "unique") => void;
  onSetNumericRangeFilter: (val: { min: number; max: number } | null) => void;
  onSetTimelinePeriodFilter: (val: string | null) => void;
  onClearAllFacetFilters: () => void;
  onSetRenamingFacetValue: (val: string | null) => void;
  onSetRenameFacetDraft: (val: string) => void;
  onCommitFacetRename: (fromValue: string) => void;
  onPushStep: (
    kind: TransformKind,
    column: string,
    label: string,
    params?: Record<string, unknown>
  ) => void;
}

const TYPE_CAST_OPTIONS: Array<{ type: ColumnDataType; label: string }> = [
  { type: "text", label: "Texto" },
  { type: "integer", label: "Entero" },
  { type: "decimal", label: "Decimal" },
  { type: "date", label: "Fecha ISO" },
  { type: "boolean", label: "Booleano" },
];

export function ColumnQualityBar({
  activeColumn,
  qualityProfile,
  qualityFilter,
  onSetQualityFilter,
  onPushStep,
}: {
  activeColumn: string;
  qualityProfile: ColumnQualityProfile | null;
  qualityFilter: QualityFilterKind | null;
  onSetQualityFilter: (val: QualityFilterKind | null) => void;
  onPushStep: SmartFacetsPanelProps["onPushStep"];
}) {
  if (!qualityProfile || qualityProfile.totalRows === 0) return null;

  const {
    validCount,
    emptyCount,
    suspectCount,
    validPercent,
    emptyPercent,
    suspectPercent,
    totalRows,
  } = qualityProfile;

  const vPct = (validCount / totalRows) * 100;
  const ePct = (emptyCount / totalRows) * 100;
  const sPct = (suspectCount / totalRows) * 100;

  return (
    <div className="mr-quality-card">
      <div className="mr-quality-head">
        <span>Calidad de columna</span>
        {qualityFilter && (
          <button
            type="button"
            className="mr-pick-btn"
            onClick={() => onSetQualityFilter(null)}
            title="Quitar filtro de calidad"
          >
            Ver todos
          </button>
        )}
      </div>

      <div className="mr-quality-bar" role="group" aria-label="Barra de calidad de columna">
        {validCount > 0 && (
          <button
            type="button"
            className={`mr-quality-seg valid ${qualityFilter === "valid" ? "active" : ""}`}
            style={{ width: `${Math.max(4, vPct)}%` }}
            title={`Válidos: ${validCount} (${validPercent}%) — Clic para aislar`}
            onClick={() => onSetQualityFilter(qualityFilter === "valid" ? null : "valid")}
          />
        )}
        {emptyCount > 0 && (
          <button
            type="button"
            className={`mr-quality-seg empty ${qualityFilter === "empty" ? "active" : ""}`}
            style={{ width: `${Math.max(4, ePct)}%` }}
            title={`Vacíos: ${emptyCount} (${emptyPercent}%) — Clic para aislar`}
            onClick={() => onSetQualityFilter(qualityFilter === "empty" ? null : "empty")}
          />
        )}
        {suspectCount > 0 && (
          <button
            type="button"
            className={`mr-quality-seg suspect ${qualityFilter === "suspect" ? "active" : ""}`}
            style={{ width: `${Math.max(4, sPct)}%` }}
            title={`Sospechosos / Errores: ${suspectCount} (${suspectPercent}%) — Clic para aislar`}
            onClick={() => onSetQualityFilter(qualityFilter === "suspect" ? null : "suspect")}
          />
        )}
      </div>

      <div className="mr-quality-legend">
        <button
          type="button"
          className={`mr-q-pill valid ${qualityFilter === "valid" ? "active" : ""}`}
          onClick={() => onSetQualityFilter(qualityFilter === "valid" ? null : "valid")}
        >
          ● Válidos {validPercent}% ({validCount})
        </button>
        <button
          type="button"
          className={`mr-q-pill empty ${qualityFilter === "empty" ? "active" : ""}`}
          onClick={() => onSetQualityFilter(qualityFilter === "empty" ? null : "empty")}
        >
          ○ Vacíos {emptyPercent}% ({emptyCount})
        </button>
        <button
          type="button"
          className={`mr-q-pill suspect ${qualityFilter === "suspect" ? "active" : ""}`}
          onClick={() => onSetQualityFilter(qualityFilter === "suspect" ? null : "suspect")}
        >
          ▲ Errores/Incons. {suspectPercent}% ({suspectCount})
        </button>
      </div>

      {qualityFilter === "empty" && emptyCount > 0 && (
        <div className="mr-quality-actions">
          <button
            type="button"
            className="mr-op-btn"
            onClick={() =>
              onPushStep("fill_empty_default", activeColumn, `Vacíos → "Sin dato" (${activeColumn})`, {
                replacement: "Sin dato",
              })
            }
          >
            → "Sin dato"
          </button>
          <button
            type="button"
            className="mr-op-btn"
            onClick={() => onPushStep("fill_down", activeColumn, `Rellenar abajo (${activeColumn})`)}
          >
            Rellenar abajo
          </button>
          <button
            type="button"
            className="mr-op-btn"
            onClick={() => onPushStep("fill_up", activeColumn, `Rellenar arriba (${activeColumn})`)}
          >
            Rellenar arriba
          </button>
          <button
            type="button"
            className="mr-op-btn mr-op-btn-danger"
            onClick={() =>
              onPushStep("delete_empty_rows", activeColumn, `Eliminar filas sin "${activeColumn}"`)
            }
          >
            Eliminar vacías
          </button>
        </div>
      )}

      {qualityFilter === "suspect" && suspectCount > 0 && (
        <div className="mr-quality-actions">
          <button
            type="button"
            className="mr-op-btn"
            onClick={() =>
              onPushStep("clean_deep", activeColumn, `Trim + Clean profundo (${activeColumn})`)
            }
          >
            <Sparkles size={11} /> Trim + Clean
          </button>
          <button
            type="button"
            className="mr-op-btn"
            onClick={() =>
              onPushStep("replace_errors", activeColumn, `Reemplazar errores por vacío (${activeColumn})`, {
                replacement: "",
              })
            }
          >
            <Eraser size={11} /> Errores → Vacío
          </button>
          <button
            type="button"
            className="mr-op-btn mr-op-btn-danger"
            onClick={() =>
              onPushStep("remove_error_rows", activeColumn, `Eliminar filas con error (${activeColumn})`)
            }
          >
            <Trash2 size={11} /> Quitar filas error
          </button>
        </div>
      )}
    </div>
  );
}

export function SmartFacetsPanel(props: SmartFacetsPanelProps) {
  const {
    activeColumn,
    isDateCol,
    qualityProfile,
    duplicateSummary,
    numericRangeProfile,
    timelineBuckets,
    facets,
    facetFilter,
    qualityFilter,
    typeFilter,
    duplicateFilter,
    numericRangeFilter,
    timelinePeriodFilter,
    filterAlias,
    isEditingFilterAlias,
    renamingFacetValue,
    renameFacetDraft,
    onSetIsEditingFilterAlias,
    onSetFilterAlias,
    onSetFacetFilter,
    onSetTypeFilter,
    onSetDuplicateFilter,
    onSetNumericRangeFilter,
    onSetTimelinePeriodFilter,
    onClearAllFacetFilters,
    onSetRenamingFacetValue,
    onSetRenameFacetDraft,
    onCommitFacetRename,
    onPushStep,
  } = props;

  const [facetMode, setFacetMode] = useState<FacetMode>("values");
  const [castOnError, setCastOnError] = useState<"mark" | "null" | "keep">("mark");

  const hasAnyActiveFilter =
    facetFilter !== null ||
    qualityFilter !== null ||
    typeFilter !== null ||
    duplicateFilter !== "all" ||
    numericRangeFilter !== null ||
    timelinePeriodFilter !== null;

  const maxBinCount = numericRangeProfile
    ? Math.max(1, ...numericRangeProfile.bins.map((b) => b.count))
    : 1;
  const maxTimelineCount =
    timelineBuckets.length > 0 ? Math.max(1, ...timelineBuckets.map((b) => b.count)) : 1;

  return (
    <div>
      {/* Selector de lente de faceta */}
      <div className="mr-facet-modes" role="tablist" aria-label="Modos de faceta">
        {(
          [
            ["values", "Valores"],
            ["duplicates", "Duplicados"],
            ["types", "Tipos"],
            ["range", "Rango"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={facetMode === mode}
            className={`mr-facet-mode-btn ${facetMode === mode ? "active" : ""}`}
            onClick={() => setFacetMode(mode)}
          >
            {label}
            {mode === "duplicates" && duplicateSummary && duplicateSummary.duplicateColumnRows > 0 && (
              <span className="mr-mini-dot" />
            )}
          </button>
        ))}
      </div>

      {/* Banner unificado cuando hay algún filtro de faceta activo */}
      {hasAnyActiveFilter && (
        <div className="mr-filter-banner">
          {facetFilter !== null && isEditingFilterAlias ? (
            <input
              className="mr-cell-input"
              autoFocus
              value={filterAlias}
              placeholder="Nombre del filtro..."
              onChange={(e) => onSetFilterAlias(e.target.value)}
              onBlur={() => onSetIsEditingFilterAlias(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  onSetIsEditingFilterAlias(false);
                }
              }}
            />
          ) : (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              Filtro activo:{" "}
              <strong>
                {facetFilter !== null
                  ? filterAlias.trim() || facetFilter || "(celda vacía)"
                  : qualityFilter
                    ? `Calidad: ${qualityFilter === "valid" ? "Válidos" : qualityFilter === "empty" ? "Vacíos" : "Errores/Sospechosos"}`
                    : typeFilter
                      ? `Tipo: ${typeFilter}`
                      : duplicateFilter !== "all"
                        ? duplicateFilter === "duplicates"
                          ? "Solo repetidos (>1)"
                          : "Solo únicos (=1)"
                        : numericRangeFilter
                          ? `Rango ${numericRangeFilter.min.toFixed(1)}–${numericRangeFilter.max.toFixed(1)}`
                          : `Periodo: ${timelinePeriodFilter}`}
              </strong>
            </span>
          )}
          <span className="mr-facet-actions">
            {facetFilter !== null && (
              <button
                className="mr-icon-btn"
                title="Renombrar etiqueta de filtro"
                onClick={() => onSetIsEditingFilterAlias(true)}
              >
                <Pencil size={12} />
              </button>
            )}
            <button
              className="mr-icon-btn"
              title="Quitar filtros de faceta"
              onClick={onClearAllFacetFilters}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {/* MODO 1: VALORES (Lista clásica de OpenRefine) */}
      {facetMode === "values" &&
        facets.map((f) => {
          const isRenamingThis = renamingFacetValue === f.value;
          return (
            <div
              key={f.value || "__empty__"}
              className={`mr-facet-item ${facetFilter === f.value ? "selected" : ""}`}
              onClick={() => {
                if (isRenamingThis) return;
                onSetFacetFilter(facetFilter === f.value ? null : f.value);
              }}
            >
              {isRenamingThis ? (
                <input
                  className="mr-cell-input"
                  autoFocus
                  value={renameFacetDraft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetRenameFacetDraft(e.target.value)}
                  onBlur={() => onCommitFacetRename(f.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommitFacetRename(f.value);
                    if (e.key === "Escape") onSetRenamingFacetValue(null);
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
                    onSetRenamingFacetValue(f.value);
                    onSetRenameFacetDraft(f.value);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <span className="mr-facet-count">{f.count}</span>
              </span>
            </div>
          );
        })}

      {/* MODO 2: DUPLICADOS (Uniqueness Facet + Deduplicación en 1 clic) */}
      {facetMode === "duplicates" && duplicateSummary && (
        <div className="mr-subfacet-wrap">
          <div className="mr-subfacet-stats">
            <div>
              <strong>{duplicateSummary.repeatedValueGroups}</strong> valores repetidos (
              <strong>{duplicateSummary.duplicateColumnRows}</strong> filas extra)
            </div>
            <div>
              <strong>{duplicateSummary.exactRowDuplicates}</strong> filas 100% idénticas en tabla
            </div>
          </div>

          <div className="mr-ops-grid" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={`mr-op-btn ${duplicateFilter === "all" ? "active" : ""}`}
              onClick={() => onSetDuplicateFilter("all")}
            >
              Todos
            </button>
            <button
              type="button"
              className={`mr-op-btn ${duplicateFilter === "duplicates" ? "active" : ""}`}
              onClick={() =>
                onSetDuplicateFilter(duplicateFilter === "duplicates" ? "all" : "duplicates")
              }
            >
              Repetidos (&gt;1)
            </button>
            <button
              type="button"
              className={`mr-op-btn full ${duplicateFilter === "unique" ? "active" : ""}`}
              onClick={() => onSetDuplicateFilter(duplicateFilter === "unique" ? "all" : "unique")}
            >
              Solo únicos (=1)
            </button>
          </div>

          {(duplicateSummary.duplicateColumnRows > 0 || duplicateSummary.exactRowDuplicates > 0) && (
            <div className="mr-ops-group" style={{ marginBottom: 8 }}>
              <div className="mr-ops-group-title">
                <span>Acciones rápidas</span>
              </div>
              <div className="mr-ops-grid">
                {duplicateSummary.duplicateColumnRows > 0 && (
                  <>
                    <button
                      type="button"
                      className="mr-op-btn"
                      onClick={() =>
                        onPushStep(
                          "remove_duplicates",
                          activeColumn,
                          `Quitar duplicados por "${activeColumn}" (conservar 1º)`,
                          { scope: "column", keep: "first" }
                        )
                      }
                    >
                      Dejar 1º (Col)
                    </button>
                    <button
                      type="button"
                      className="mr-op-btn"
                      onClick={() =>
                        onPushStep(
                          "remove_duplicates",
                          activeColumn,
                          `Quitar duplicados por "${activeColumn}" (conservar último)`,
                          { scope: "column", keep: "last" }
                        )
                      }
                    >
                      Dejar último (Col)
                    </button>
                  </>
                )}
                {duplicateSummary.exactRowDuplicates > 0 && (
                  <button
                    type="button"
                    className="mr-op-btn full"
                    onClick={() =>
                      onPushStep(
                        "remove_duplicates",
                        activeColumn,
                        `Eliminar ${duplicateSummary.exactRowDuplicates} filas 100% idénticas`,
                        { scope: "row", keep: "first" }
                      )
                    }
                  >
                    Quitar filas idénticas ({duplicateSummary.exactRowDuplicates})
                  </button>
                )}
              </div>
            </div>
          )}

          {duplicateSummary.repeatedItems.length === 0 ? (
            <div className="mr-subfacet-empty">
              Todos los valores no vacíos de "{activeColumn}" son únicos.
            </div>
          ) : (
            duplicateSummary.repeatedItems.map((item) => (
              <div
                key={item.value}
                className={`mr-facet-item ${facetFilter === item.value ? "selected" : ""}`}
                onClick={() => onSetFacetFilter(facetFilter === item.value ? null : item.value)}
              >
                <span className="mr-facet-label">{item.value}</span>
                <span className="mr-facet-count">{item.count}×</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* MODO 3: TIPOS DE DATO (Type Distribution + Cast seguro) */}
      {facetMode === "types" && qualityProfile && (
        <div className="mr-subfacet-wrap">
          <div className="mr-subfacet-stats">
            Tipo predominante: <strong>{qualityProfile.dominantType.toUpperCase()}</strong>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {qualityProfile.typeDistribution.map((item) => (
              <button
                key={item.type}
                type="button"
                className={`mr-type-row ${typeFilter === item.type ? "selected" : ""}`}
                onClick={() => onSetTypeFilter(typeFilter === item.type ? null : item.type)}
                title={`Clic para aislar celdas de tipo ${item.label}`}
              >
                <div className="mr-type-row-top">
                  <span>{item.label}</span>
                  <span>
                    {item.count} ({item.percent}%)
                  </span>
                </div>
                <div className="mr-type-bar-track">
                  <div
                    className={`mr-type-bar-fill type-${item.type}`}
                    style={{ width: `${Math.max(4, item.percent)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>

          <div className="mr-ops-group">
            <div className="mr-ops-group-title">
              <span>Convertir columna a tipo</span>
            </div>
            <select
              className="mr-date-select"
              style={{ width: "100%", marginBottom: 6 }}
              value={castOnError}
              onChange={(e) => setCastOnError(e.target.value as "mark" | "null" | "keep")}
              title="Qué hacer con celdas que no puedan convertirse"
            >
              <option value="mark">Si falla conversión: Marcar #ERROR!</option>
              <option value="null">Si falla conversión: Dejar vacío</option>
              <option value="keep">Si falla conversión: Conservar original</option>
            </select>
            <div className="mr-ops-grid">
              {TYPE_CAST_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  className="mr-op-btn"
                  onClick={() =>
                    onPushStep(
                      "cast_column_type",
                      activeColumn,
                      `Tipar "${activeColumn}" como ${opt.label}`,
                      { targetType: opt.type, onError: castOnError }
                    )
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODO 4: RANGO CONTINUO (Histograma Numérico o Timeline de Fechas) */}
      {facetMode === "range" && (
        <div className="mr-subfacet-wrap">
          {isDateCol && timelineBuckets.length > 0 ? (
            <>
              <div className="mr-subfacet-stats">
                Línea de tiempo por periodo ({timelineBuckets.length} periodos)
              </div>
              <div className="mr-timeline-list">
                {timelineBuckets.map((b) => (
                  <button
                    key={b.period}
                    type="button"
                    className={`mr-timeline-row ${timelinePeriodFilter === b.period ? "selected" : ""}`}
                    onClick={() =>
                      onSetTimelinePeriodFilter(
                        timelinePeriodFilter === b.period ? null : b.period
                      )
                    }
                  >
                    <span className="mr-timeline-label">{b.period}</span>
                    <div className="mr-timeline-bar-wrap">
                      <div
                        className="mr-timeline-bar"
                        style={{ width: `${Math.max(5, (b.count / maxTimelineCount) * 100)}%` }}
                      />
                    </div>
                    <span className="mr-facet-count">{b.count}</span>
                  </button>
                ))}
              </div>
            </>
          ) : numericRangeProfile ? (
            <>
              <div className="mr-subfacet-stats">
                Rango numérico: <strong>{numericRangeProfile.min}</strong> a{" "}
                <strong>{numericRangeProfile.max}</strong> ({numericRangeProfile.numericCount} celdas)
              </div>

              <div className="mr-histogram" role="group" aria-label="Histograma numérico">
                {numericRangeProfile.bins.map((bin) => {
                  const isSelected =
                    numericRangeFilter !== null &&
                    Math.abs(numericRangeFilter.min - bin.min) < 1e-6 &&
                    Math.abs(numericRangeFilter.max - bin.max) < 1e-6;
                  return (
                    <button
                      key={bin.index}
                      type="button"
                      className={`mr-hist-bar-col ${isSelected ? "selected" : ""}`}
                      title={`${bin.label}: ${bin.count} filas — Clic para filtrar`}
                      onClick={() =>
                        onSetNumericRangeFilter(
                          isSelected ? null : { min: bin.min, max: bin.max }
                        )
                      }
                    >
                      <div
                        className="mr-hist-bar"
                        style={{
                          height: `${bin.count === 0 ? 3 : Math.max(10, (bin.count / maxBinCount) * 100)}%`,
                        }}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mr-range-inputs">
                <label>
                  Mín
                  <input
                    type="number"
                    className="mr-cell-input"
                    value={numericRangeFilter?.min ?? numericRangeProfile.min}
                    onChange={(e) => {
                      const nextMin = Number(e.target.value);
                      if (!Number.isFinite(nextMin)) return;
                      onSetNumericRangeFilter({
                        min: nextMin,
                        max: numericRangeFilter?.max ?? numericRangeProfile.max,
                      });
                    }}
                  />
                </label>
                <label>
                  Máx
                  <input
                    type="number"
                    className="mr-cell-input"
                    value={numericRangeFilter?.max ?? numericRangeProfile.max}
                    onChange={(e) => {
                      const nextMax = Number(e.target.value);
                      if (!Number.isFinite(nextMax)) return;
                      onSetNumericRangeFilter({
                        min: numericRangeFilter?.min ?? numericRangeProfile.min,
                        max: nextMax,
                      });
                    }}
                  />
                </label>
              </div>
              {numericRangeFilter && (
                <button
                  type="button"
                  className="mr-op-btn full"
                  style={{ marginTop: 6 }}
                  onClick={() => onSetNumericRangeFilter(null)}
                >
                  Restablecer rango completo
                </button>
              )}
            </>
          ) : (
            <div className="mr-subfacet-empty">
              La columna "{activeColumn}" es de texto libre. Usa las pestañas{" "}
              <strong>Valores</strong>, <strong>Duplicados</strong> o <strong>Tipos</strong>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
