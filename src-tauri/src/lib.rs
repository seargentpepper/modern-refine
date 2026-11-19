use modern_refine_engine::duckdb_engine::{DuckDbEngine, DuckDbStatus, DuckQueryResult};
use modern_refine_engine::sources::{
    build_sql_preview_query, parse_csv_snapshot, parse_html_tables, parse_json_tabular,
    validate_sql_read_only, AuthMethod, SourceConnectionParams, SourceKind, SourcePreview,
    SourceSnapshot, SqlDialect, TableSchema,
};
use modern_refine_engine::{ClusterGroup, ColumnProfileResult, SplitNameResult};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

struct DuckDbState(Mutex<Option<DuckDbEngine>>);

fn with_duckdb<F, T>(state: &tauri::State<'_, DuckDbState>, f: F) -> Result<T, String>
where
    F: FnOnce(&mut DuckDbEngine) -> Result<T, String>,
{
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Error de concurrencia en DuckDB nativo".to_string())?;
    if guard.is_none() {
        *guard = Some(DuckDbEngine::open_in_memory()?);
    }
    let engine = guard.as_mut().ok_or("DuckDB no inicializado")?;
    f(engine)
}

#[tauri::command]
fn refine_cluster(column: &str, facets: Vec<(String, usize)>) -> Vec<ClusterGroup> {
    modern_refine_engine::cluster_unique_facets(column, &facets)
}

#[tauri::command]
fn refine_split_latin_name(full_name: &str) -> SplitNameResult {
    modern_refine_engine::split_latin_american_name(full_name)
}

#[tauri::command]
fn refine_profile_column(column: &str, values: Vec<String>) -> ColumnProfileResult {
    modern_refine_engine::profile_column_values(column, &values)
}

#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Error al escribir archivo '{}': {}", path, e))
}

fn normalize_wikipedia_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    let slug = trimmed.replace(' ', "_");
    format!("https://es.wikipedia.org/wiki/{}", slug)
}

async fn fetch_url_text(params: &SourceConnectionParams, target_url: &str) -> Result<String, String> {
    let timeout = Duration::from_secs(params.timeout_seconds.unwrap_or(20).clamp(3, 120));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("ModernRefine/0.4 (Pre-BI Cleaning Station)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(target_url);
    if let Some(headers) = &params.headers {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }
    if let Some(auth) = &params.auth {
        if matches!(auth.method, Some(AuthMethod::Bearer)) {
            if let Some(token) = &auth.password {
                if !token.trim().is_empty() {
                    req = req.bearer_auth(token.trim());
                }
            }
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con '{}': {}", target_url, e))?;

    if !resp.status().is_success() {
        return Err(format!("El servidor respondió con HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Error leyendo respuesta HTTP: {}", e))
}

#[tauri::command]
async fn preview_external_source(params: SourceConnectionParams) -> Result<SourcePreview, String> {
    match params.kind {
        SourceKind::WebJson => {
            let url = params
                .url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Ingresa una URL válida.".to_string())?;
            let text = fetch_url_text(&params, url).await?;
            let name = url
                .split('/')
                .filter(|s| !s.is_empty())
                .last()
                .unwrap_or("Web_Snapshot")
                .split('?')
                .next()
                .unwrap_or("Web_Snapshot");

            let trimmed = text.trim_start();
            if trimmed.starts_with('{') || trimmed.starts_with('[') {
                parse_json_tabular(name, &text, Some(100))
            } else {
                parse_csv_snapshot(name, &text, Some(100))
            }
        }
        SourceKind::Wikipedia => {
            let raw = params
                .url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Ingresa un artículo o URL de Wikipedia.".to_string())?;
            let target_url = normalize_wikipedia_url(raw);
            let html = fetch_url_text(&params, &target_url).await?;
            let tables = parse_html_tables(&html);
            if tables.is_empty() {
                return Err("No se encontraron tablas estructuradas en esa página.".to_string());
            }
            let idx = params.table_index.unwrap_or(0).min(tables.len() - 1);
            let chosen = &tables[idx];
            let schemas: Vec<TableSchema> = tables
                .iter()
                .map(|t| TableSchema {
                    name: t.name.clone(),
                    columns: t.columns.clone(),
                    row_count_hint: Some(t.rows.len()),
                })
                .collect();

            Ok(SourcePreview {
                source_name: chosen.name.clone(),
                columns: chosen.columns.clone(),
                sample_rows: chosen.rows.iter().take(100).cloned().collect(),
                total_estimated_rows: Some(chosen.rows.len()),
                tables: schemas,
            })
        }
        SourceKind::Sql => {
            let server = params
                .server
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Especifica el nombre o IP del servidor SQL.".to_string())?;
            if let Some(q) = params.custom_sql_query.as_deref() {
                validate_sql_read_only(q)?;
            }
            let dialect = params.sql_dialect.unwrap_or(SqlDialect::Sqlserver);
            let target = params
                .custom_sql_query
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .or(params.table_or_query.as_deref())
                .unwrap_or("dbo.Tabla");
            let preview_sql = build_sql_preview_query(&dialect, target, 100);
            Err(format!(
                "Conexión preparada hacia '{}' ({}). Consulta de snapshot lista: `{}`. Habilita el driver nativo SQL (`sqlx`/`tiberius`) en el build empresarial para ejecutar TCP directo.",
                server,
                params.database.as_deref().unwrap_or("sin base especificada"),
                preview_sql
            ))
        }
        SourceKind::File => Err("Usa el selector de archivos locales para archivos en disco.".to_string()),
    }
}

#[tauri::command]
async fn fetch_external_snapshot(params: SourceConnectionParams) -> Result<SourceSnapshot, String> {
    match params.kind {
        SourceKind::WebJson => {
            let url = params
                .url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Ingresa una URL válida.".to_string())?;
            let text = fetch_url_text(&params, url).await?;
            let name = url
                .split('/')
                .filter(|s| !s.is_empty())
                .last()
                .unwrap_or("Web_Snapshot")
                .split('?')
                .next()
                .unwrap_or("Web_Snapshot");
            let trimmed = text.trim_start();
            let (preview, delim) = if trimmed.starts_with('{') || trimmed.starts_with('[') {
                (parse_json_tabular(name, &text, None)?, "Web JSON")
            } else {
                (parse_csv_snapshot(name, &text, None)?, "Web CSV")
            };
            Ok(SourceSnapshot {
                source_name: preview.source_name,
                columns: preview.columns,
                rows: preview.sample_rows,
                delimiter_label: delim.to_string(),
            })
        }
        SourceKind::Wikipedia => {
            let raw = params
                .url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Ingresa un artículo o URL de Wikipedia.".to_string())?;
            let target_url = normalize_wikipedia_url(raw);
            let html = fetch_url_text(&params, &target_url).await?;
            let tables = parse_html_tables(&html);
            if tables.is_empty() {
                return Err("No se encontraron tablas estructuradas en esa página.".to_string());
            }
            let idx = params.table_index.unwrap_or(0).min(tables.len() - 1);
            let chosen = tables.into_iter().nth(idx).ok_or("Tabla no encontrada")?;
            Ok(SourceSnapshot {
                source_name: chosen.name,
                columns: chosen.columns,
                rows: chosen.rows,
                delimiter_label: "Wikipedia HTML".to_string(),
            })
        }
        SourceKind::Sql => preview_external_source(params)
            .await
            .map(|p| SourceSnapshot {
                source_name: p.source_name,
                columns: p.columns,
                rows: p.sample_rows,
                delimiter_label: "SQL Snapshot".to_string(),
            }),
        SourceKind::File => Err("Usa el selector de archivos locales.".to_string()),
    }
}

#[tauri::command]
fn duckdb_engine_status(state: tauri::State<'_, DuckDbState>) -> Result<DuckDbStatus, String> {
    with_duckdb(&state, |engine| engine.status())
}

#[tauri::command]
fn duckdb_sync_session(
    state: tauri::State<'_, DuckDbState>,
    table_name: String,
    columns: Vec<String>,
    rows: Vec<HashMap<String, String>>,
) -> Result<DuckDbStatus, String> {
    with_duckdb(&state, |engine| {
        engine.load_snapshot(&table_name, &columns, &rows)?;
        engine.status()
    })
}

#[tauri::command]
fn duckdb_query_preview(
    state: tauri::State<'_, DuckDbState>,
    sql: String,
    limit: Option<usize>,
) -> Result<DuckQueryResult, String> {
    with_duckdb(&state, |engine| engine.query_read_only(&sql, limit.unwrap_or(500)))
}

#[tauri::command]
fn duckdb_group_summary(
    state: tauri::State<'_, DuckDbState>,
    table_name: String,
    columns: Vec<String>,
    rows: Vec<HashMap<String, String>>,
    group_col: String,
    value_col: String,
    agg: String,
) -> Result<DuckQueryResult, String> {
    with_duckdb(&state, |engine| {
        let tname = engine.load_snapshot(&table_name, &columns, &rows)?;
        engine.group_by_summary(&tname, &group_col, &value_col, &agg)
    })
}

#[tauri::command]
fn duckdb_export_parquet(
    state: tauri::State<'_, DuckDbState>,
    table_name: String,
    columns: Vec<String>,
    rows: Vec<HashMap<String, String>>,
    out_path: String,
) -> Result<(), String> {
    with_duckdb(&state, |engine| {
        let tname = engine.load_snapshot(&table_name, &columns, &rows)?;
        engine.export_parquet(&tname, &out_path)
    })
}

#[tauri::command]
fn duckdb_evaluate_window_magic(
    state: tauri::State<'_, DuckDbState>,
    table_name: String,
    columns: Vec<String>,
    rows: Vec<HashMap<String, String>>,
    fn_name: String,
    value_col: String,
    partition_col: Option<String>,
) -> Result<Vec<String>, String> {
    with_duckdb(&state, |engine| {
        let tname = engine.load_snapshot(&table_name, &columns, &rows)?;
        engine.evaluate_window_magic(&tname, &fn_name, &value_col, partition_col.as_deref())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DuckDbState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            refine_cluster,
            refine_split_latin_name,
            refine_profile_column,
            write_export_file,
            preview_external_source,
            fetch_external_snapshot,
            duckdb_engine_status,
            duckdb_sync_session,
            duckdb_query_preview,
            duckdb_group_summary,
            duckdb_export_parquet,
            duckdb_evaluate_window_magic
        ])
        .run(tauri::generate_context!())
        .expect("error while running ModernRefine tauri desktop application");
}
