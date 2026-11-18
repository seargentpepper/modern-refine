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

export type TransformKind =
  | "trim"
  | "title_case"
  | "upper_case"
  | "lower_case"
  | "strip_accents"
  | "extract_numbers"
  | "pad_postal_code"
  | "split_keep_left"
  | "split_keep_right"
  | "standardize_dates"
  | "fill_empty_default"
  | "fill_down"
  | "merge_cluster"
  | "rename_facet"
  | "delete_row"
  | "delete_empty_rows"
  | "restore_rows"
  | "edit_cell";

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
