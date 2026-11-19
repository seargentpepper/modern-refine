use crate::sources::validate_sql_read_only;
use duckdb::types::ValueRef;
use duckdb::{appender_params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbStatus {
    pub available: bool,
    pub engine: String,
    pub version: String,
    pub active_table: Option<String>,
    pub row_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
    pub row_count: usize,
    pub elapsed_ms: u64,
}

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn quote_str(val: &str) -> String {
    format!("'{}'", val.replace('\'', "''"))
}

pub fn sanitize_table_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "tabla_activa".to_string()
    } else if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("t_{}", trimmed)
    } else {
        trimmed.to_string()
    }
}

fn value_ref_to_string(v: ValueRef<'_>) -> String {
    match v {
        ValueRef::Null => String::new(),
        ValueRef::Boolean(b) => if b { "TRUE" } else { "FALSE" }.to_string(),
        ValueRef::TinyInt(i) => i.to_string(),
        ValueRef::SmallInt(i) => i.to_string(),
        ValueRef::Int(i) => i.to_string(),
        ValueRef::BigInt(i) => i.to_string(),
        ValueRef::HugeInt(i) => i.to_string(),
        ValueRef::UTinyInt(u) => u.to_string(),
        ValueRef::USmallInt(u) => u.to_string(),
        ValueRef::UInt(u) => u.to_string(),
        ValueRef::UBigInt(u) => u.to_string(),
        ValueRef::Float(f) => {
            if f.fract() == 0.0 {
                format!("{:.0}", f)
            } else {
                f.to_string()
            }
        }
        ValueRef::Double(d) => {
            if d.fract() == 0.0 {
                format!("{:.0}", d)
            } else {
                format!("{:.4}", d)
                    .trim_end_matches('0')
                    .trim_end_matches('.')
                    .to_string()
            }
        }
        ValueRef::Decimal(d) => d.to_string(),
        ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).to_string(),
        ValueRef::Blob(bytes) => format!("<{} bytes>", bytes.len()),
        other => format!("{:?}", other),
    }
}

pub struct DuckDbEngine {
    pub conn: Connection,
    pub active_table: Option<String>,
    pub row_count: usize,
}

impl DuckDbEngine {
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Ok(Self {
            conn,
            active_table: None,
            row_count: 0,
        })
    }

    pub fn version(&self) -> Result<String, String> {
        self.conn
            .query_row("SELECT version()", [], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())
    }

    pub fn status(&self) -> Result<DuckDbStatus, String> {
        let version = self.version()?;
        Ok(DuckDbStatus {
            available: true,
            engine: "DuckDB Native (Rust C++ Engine)".to_string(),
            version,
            active_table: self.active_table.clone(),
            row_count: self.row_count,
        })
    }

    /// Carga un snapshot plano de filas dentro de DuckDB nativo usando Appender de alto rendimiento
    pub fn load_snapshot(
        &mut self,
        raw_table_name: &str,
        columns: &[String],
        rows: &[HashMap<String, String>],
    ) -> Result<String, String> {
        if columns.is_empty() {
            return Err("La tabla no tiene columnas para sincronizar con DuckDB.".to_string());
        }
        let table_name = sanitize_table_name(raw_table_name);
        let q_table = quote_ident(&table_name);

        self.conn
            .execute(&format!("DROP TABLE IF EXISTS {}", q_table), [])
            .map_err(|e| e.to_string())?;

        let mut col_defs = vec!["\"__orig_idx\" BIGINT".to_string()];
        for col in columns {
            col_defs.push(format!("{} VARCHAR", quote_ident(col)));
        }

        let ddl = format!("CREATE TABLE {} ({})", q_table, col_defs.join(", "));
        self.conn.execute(&ddl, []).map_err(|e| e.to_string())?;

        {
            let mut appender = self
                .conn
                .appender(&table_name)
                .map_err(|e| format!("Error creando Appender DuckDB: {}", e))?;

            for (idx, row) in rows.iter().enumerate() {
                let mut values: Vec<duckdb::types::Value> = Vec::with_capacity(columns.len() + 1);
                values.push(duckdb::types::Value::BigInt(idx as i64));
                for col in columns {
                    let cell = row.get(col).map(String::as_str).unwrap_or("");
                    values.push(duckdb::types::Value::Text(cell.to_string()));
                }
                appender
                    .append_row(appender_params_from_iter(values))
                    .map_err(|e| format!("Error insertando fila {} en DuckDB: {}", idx + 1, e))?;
            }
            appender.flush().map_err(|e| e.to_string())?;
        }

        self.active_table = Some(table_name.clone());
        self.row_count = rows.len();
        Ok(table_name)
    }

    /// Ejecuta una consulta SQL de solo lectura (SELECT / WITH) con límite seguro
    pub fn query_read_only(&self, sql: &str, limit: usize) -> Result<DuckQueryResult, String> {
        validate_sql_read_only(sql)?;
        let cleaned = sql.trim().trim_end_matches(';');
        let wrapped = if limit > 0 {
            format!("SELECT * FROM ({}) AS _mr_q LIMIT {}", cleaned, limit)
        } else {
            cleaned.to_string()
        };

        let start = Instant::now();
        let mut stmt = self
            .conn
            .prepare(&wrapped)
            .map_err(|e| format!("Error SQL DuckDB: {}", e))?;

        let mut rows_iter = stmt.query([]).map_err(|e| format!("Error ejecutando consulta: {}", e))?;
        let col_count = rows_iter.as_ref().map(|s| s.column_count()).unwrap_or(0);
        let mut columns = Vec::with_capacity(col_count);
        if let Some(stmt_ref) = rows_iter.as_ref() {
            for i in 0..col_count {
                let name = stmt_ref
                    .column_name(i)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|_| format!("col_{}", i + 1));
                columns.push(name);
            }
        }

        let mut out_rows = Vec::new();
        while let Some(row) = rows_iter.next().map_err(|e| e.to_string())? {
            let mut map = HashMap::with_capacity(columns.len());
            for (i, col_name) in columns.iter().enumerate() {
                let val_ref = row.get_ref(i).map_err(|e| e.to_string())?;
                map.insert(col_name.clone(), value_ref_to_string(val_ref));
            }
            out_rows.push(map);
        }

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let row_count = out_rows.len();
        Ok(DuckQueryResult {
            columns,
            rows: out_rows,
            row_count,
            elapsed_ms,
        })
    }

    /// Agrupamiento rápido nativo en DuckDB (Preview / Nueva Pestaña Agregada)
    pub fn group_by_summary(
        &self,
        table_name: &str,
        group_col: &str,
        value_col: &str,
        agg: &str,
    ) -> Result<DuckQueryResult, String> {
        let q_table = quote_ident(&sanitize_table_name(table_name));
        let q_group = quote_ident(group_col);
        let q_val = quote_ident(value_col);
        let num_expr = format!(
            "TRY_CAST(NULLIF(REPLACE(REPLACE(TRIM({}), '$', ''), ',', ''), '') AS DOUBLE)",
            q_val
        );

        let (agg_expr, alias) = match agg.to_ascii_uppercase().as_str() {
            "SUM" => (format!("ROUND(SUM({}), 2)", num_expr), format!("Suma_{}", value_col)),
            "AVG" => (format!("ROUND(AVG({}), 2)", num_expr), format!("Promedio_{}", value_col)),
            "MIN" => (format!("MIN({})", num_expr), format!("Min_{}", value_col)),
            "MAX" => (format!("MAX({})", num_expr), format!("Max_{}", value_col)),
            _ => ("COUNT(*)".to_string(), "Conteo_Filas".to_string()),
        };

        let sql = format!(
            "SELECT COALESCE(NULLIF(TRIM({}), ''), '(vacío)') AS {}, COUNT(*) AS \"Registros\", {} AS {} FROM {} GROUP BY 1 ORDER BY \"Registros\" DESC",
            q_group,
            q_group,
            agg_expr,
            quote_ident(&alias),
            q_table
        );
        self.query_read_only(&sql, 1000)
    }

    /// Exportación nativa de alta velocidad a Apache Parquet (.parquet)
    pub fn export_parquet(&self, table_name: &str, out_path: &str) -> Result<(), String> {
        let q_table = quote_ident(&sanitize_table_name(table_name));
        let copy_sql = format!(
            "COPY (SELECT * EXCLUDE (\"__orig_idx\") FROM {}) TO {} (FORMAT PARQUET)",
            q_table,
            quote_str(out_path)
        );
        self.conn
            .execute(&copy_sql, [])
            .map_err(|e| format!("Error exportando a Parquet: {}", e))?;
        Ok(())
    }

    /// Evaluador nativo de funciones mágicas de ventana y anomalías sobre DuckDB
    pub fn evaluate_window_magic(
        &self,
        table_name: &str,
        fn_name: &str,
        value_col: &str,
        partition_col: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let q_table = quote_ident(&sanitize_table_name(table_name));
        let q_val = quote_ident(value_col);
        let num_expr = format!(
            "COALESCE(TRY_CAST(NULLIF(REPLACE(REPLACE(TRIM({}), '$', ''), ',', ''), '') AS DOUBLE), 0)",
            q_val
        );
        let part_clause = partition_col
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|p| format!("PARTITION BY {} ", quote_ident(p)))
            .unwrap_or_default();

        let select_expr = match fn_name.to_ascii_uppercase().as_str() {
            "RUNNING_SUM" => format!(
                "ROUND(SUM({}) OVER ({}ORDER BY \"__orig_idx\"), 2)::VARCHAR",
                num_expr, part_clause
            ),
            "PCT_OF_TOTAL" => format!(
                "ROUND(({} * 100.0) / NULLIF(SUM({}) OVER ({}), 0), 2)::VARCHAR",
                num_expr, num_expr, part_clause
            ),
            "GROUP_AVG" => format!(
                "ROUND(AVG({}) OVER ({}), 2)::VARCHAR",
                num_expr, part_clause
            ),
            "ROW_NUM" => format!(
                "ROW_NUMBER() OVER ({}ORDER BY \"__orig_idx\")::VARCHAR",
                part_clause
            ),
            "IS_OUTLIER" => format!(
                "CASE WHEN ABS({} - AVG({}) OVER ()) > 2.0 * NULLIF(STDDEV_POP({}) OVER (), 0) THEN 'TRUE' ELSE 'FALSE' END",
                num_expr, num_expr, num_expr
            ),
            other => return Err(format!("Función de ventana no soportada: {}", other)),
        };

        let sql = format!(
            "SELECT {} AS _res FROM {} ORDER BY \"__orig_idx\"",
            select_expr, q_table
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let v = value_ref_to_string(r.get_ref(0).map_err(|e| e.to_string())?);
            out.push(v);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_data() -> (Vec<String>, Vec<HashMap<String, String>>) {
        let cols = vec![
            "Ciudad".to_string(),
            "Monto_MXN".to_string(),
        ];
        let rows = vec![
            HashMap::from([
                ("Ciudad".to_string(), "Villahermosa".to_string()),
                ("Monto_MXN".to_string(), "$1,000.00".to_string()),
            ]),
            HashMap::from([
                ("Ciudad".to_string(), "Villahermosa".to_string()),
                ("Monto_MXN".to_string(), "500".to_string()),
            ]),
            HashMap::from([
                ("Ciudad".to_string(), "Mérida".to_string()),
                ("Monto_MXN".to_string(), "1500".to_string()),
            ]),
        ];
        (cols, rows)
    }

    #[test]
    fn test_duckdb_native_snapshot_query_and_groupby() {
        let mut engine = DuckDbEngine::open_in_memory().unwrap();
        let ver = engine.version().unwrap();
        assert!(!ver.is_empty());

        let (cols, rows) = sample_data();
        let tname = engine.load_snapshot("clientes.csv", &cols, &rows).unwrap();
        assert_eq!(tname, "clientes_csv");

        let summary = engine
            .group_by_summary(&tname, "Ciudad", "Monto_MXN", "SUM")
            .unwrap();
        assert_eq!(summary.row_count, 2);
        assert_eq!(summary.rows[0]["Ciudad"], "Villahermosa");
        assert_eq!(summary.rows[0]["Suma_Monto_MXN"], "1500");
    }

    #[test]
    fn test_duckdb_native_window_magic_and_parquet() {
        let mut engine = DuckDbEngine::open_in_memory().unwrap();
        let (cols, rows) = sample_data();
        let tname = engine.load_snapshot("ventas", &cols, &rows).unwrap();

        let running = engine
            .evaluate_window_magic(&tname, "RUNNING_SUM", "Monto_MXN", None)
            .unwrap();
        assert_eq!(running, vec!["1000.0", "1500.0", "3000.0"]);

        let pct = engine
            .evaluate_window_magic(&tname, "PCT_OF_TOTAL", "Monto_MXN", None)
            .unwrap();
        assert_eq!(pct, vec!["33.33", "16.67", "50.0"]);

        let temp_parquet = std::env::temp_dir().join("modern_refine_test.parquet");
        let path_str = temp_parquet.to_string_lossy().to_string();
        engine.export_parquet(&tname, &path_str).unwrap();
        assert!(temp_parquet.exists());

        let read_back = engine
            .query_read_only(&format!("SELECT COUNT(*) AS n FROM read_parquet({})", quote_str(&path_str)), 10)
            .unwrap();
        assert_eq!(read_back.rows[0]["n"], "3");
        let _ = std::fs::remove_file(temp_parquet);
    }
}
