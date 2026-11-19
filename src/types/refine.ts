export type DataRow = Record<string, string>;

export type DateTargetFormat =
  | "iso"
  | "dmy_slash"
  | "ymd_slash"
  | "dmy_dash"
  | "mdy_slash"
  | "spanish_short"
  | "spanish_long";

export type ClusterMethod =
  | "Fingerprint"
  | "N-gram"
  | "Levenshtein"
  | "Fonético ES"
  | "Abreviatura";

export type ColumnDataType = "text" | "integer" | "decimal" | "date" | "boolean";

export type CellInferredType = "number" | "date" | "boolean" | "text" | "empty" | "error";

export type QualityFilterKind = "valid" | "empty" | "suspect";

export type FacetMode = "values" | "duplicates" | "types" | "range";

export type TransformKind =
  | "trim"
  | "clean_deep"
  | "title_case"
  | "upper_case"
  | "lower_case"
  | "strip_accents"
  | "extract_numbers"
  | "pad_postal_code"
  | "split_keep_left"
  | "split_keep_right"
  | "duplicate_column"
  | "rename_column"
  | "hide_column"
  | "restore_column"
  | "split_into_two_columns"
  | "split_column_flexible"
  | "merge_columns"
  | "extract_text"
  | "split_mexican_name"
  | "standardize_dates"
  | "cast_column_type"
  | "replace_value"
  | "replace_errors"
  | "remove_error_rows"
  | "remove_duplicates"
  | "promote_headers"
  | "unpivot_columns"
  | "fill_empty_default"
  | "fill_down"
  | "fill_up"
  | "merge_cluster"
  | "rename_facet"
  | "delete_row"
  | "delete_empty_rows"
  | "restore_rows"
  | "add_row"
  | "add_column"
  | "computed_column"
  | "edit_cell"
  | "formula";

export interface RefineStep {
  id: string;
  timestamp: string;
  enabled: boolean;
  kind: TransformKind;
  column: string;
  label: string;
  params?: Record<string, unknown>;
}

export interface IndexedRow {
  origIdx: number;
  data: DataRow;
}

export interface DeletedRowEntry {
  origIdx: number;
  data: DataRow;
  stepId: string;
  reason: string;
}

export interface FacetItem {
  value: string;
  count: number;
  isEmpty: boolean;
}

export interface ColumnDiagnostic {
  column: string;
  uniqueCount: number;
  emptyCount: number;
  whitespaceIssueCount: number;
  suspiciousDateCount: number;
  shortPostalCodeCount: number;
  errorCount: number;
  controlCharCount: number;
}

export interface TypeDistributionItem {
  type: CellInferredType;
  label: string;
  count: number;
  percent: number;
}

export interface ColumnQualityProfile {
  column: string;
  totalRows: number;
  validCount: number;
  emptyCount: number;
  suspectCount: number;
  validPercent: number;
  emptyPercent: number;
  suspectPercent: number;
  dominantType: CellInferredType;
  typeDistribution: TypeDistributionItem[];
}

export interface DuplicateSummary {
  column: string;
  totalRows: number;
  uniqueNonEmptyValues: number;
  repeatedValueGroups: number;
  duplicateColumnRows: number;
  exactRowDuplicates: number;
  repeatedItems: Array<{ value: string; count: number }>;
}

export interface NumericHistogramBin {
  index: number;
  min: number;
  max: number;
  label: string;
  count: number;
}

export interface NumericRangeProfile {
  min: number;
  max: number;
  numericCount: number;
  bins: NumericHistogramBin[];
}

export interface TimelineBucket {
  period: string;
  count: number;
}

export interface ClusterVariant {
  value: string;
  count: number;
}

export interface ClusterGroup {
  id: string;
  method: ClusterMethod;
  suggestedCanonical: string;
  variants: ClusterVariant[];
}

export interface FileIngestionMeta {
  delimiterLabel: string;
  dedupedHeaders: number;
  sheets?: string[];
  activeSheet?: string;
}

export type SourceKind = "file" | "web_json" | "wikipedia" | "sql";
export type SqlDialect = "sqlserver" | "postgres" | "mysql";
export type AuthMethod = "windows" | "database" | "anonymous" | "bearer";

export interface SourceAuthParams {
  method: AuthMethod;
  username?: string;
  password?: string;
  useCurrentWindowsCreds?: boolean;
  scopeLevel?: string;
}

export interface SourceConnectionParams {
  kind: SourceKind;
  url?: string;
  headers?: Record<string, string>;
  sqlDialect?: SqlDialect;
  server?: string;
  port?: number;
  database?: string;
  timeoutSeconds?: number;
  customSqlQuery?: string;
  tableOrQuery?: string;
  tableIndex?: number;
  auth?: SourceAuthParams;
}

/** Descriptor sanitizado que se serializa en .refine.json (NUNCA incluye contraseña o token) */
export interface SourceDescriptor {
  kind: SourceKind;
  displayName: string;
  url?: string;
  sqlDialect?: SqlDialect;
  server?: string;
  database?: string;
  tableOrQuery?: string;
  scopeLevel?: string;
}

export interface SourceTableSchema {
  name: string;
  columns: string[];
  rowCountHint?: number;
}

export interface SourcePreviewData {
  sourceName: string;
  columns: string[];
  sampleRows: DataRow[];
  totalEstimatedRows?: number;
  tables: SourceTableSchema[];
}

export interface SourceSnapshotData {
  sourceName: string;
  columns: string[];
  rows: DataRow[];
  delimiterLabel: string;
}

export interface DuckDbStatus {
  available: boolean;
  engine: string;
  version: string;
  activeTable: string | null;
  rowCount: number;
}

export interface DuckQueryResult {
  columns: string[];
  rows: DataRow[];
  rowCount: number;
  elapsedMs: number;
}

export interface TableSession {
  id: string;
  fileName: string;
  baseColumns: string[];
  baseRows: DataRow[];
  ingestionMeta: FileIngestionMeta | null;
  sourceDescriptor?: SourceDescriptor | null;
  steps: RefineStep[];
  redoStack: RefineStep[];
  selectedColumn: string;
  selectionMode: "column" | "cell";
  sortState: { column: string; dir: "asc" | "desc" } | null;
  facetFilter: string | null;
  qualityFilter: QualityFilterKind | null;
  typeFilter: CellInferredType | null;
  duplicateFilter: "all" | "duplicates" | "unique";
  numericRangeFilter: { min: number; max: number } | null;
  timelinePeriodFilter: string | null;
  filterAlias: string;
  selectedCell: { visibleIdx: number; colIdx: number } | null;
}
