use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    File,
    WebJson,
    Wikipedia,
    Sql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SqlDialect {
    Sqlserver,
    Postgres,
    Mysql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Windows,
    Database,
    Anonymous,
    Bearer,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceAuthParams {
    pub method: Option<AuthMethod>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub scope_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnectionParams {
    pub kind: SourceKind,
    pub url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub sql_dialect: Option<SqlDialect>,
    pub server: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub custom_sql_query: Option<String>,
    pub table_or_query: Option<String>,
    pub table_index: Option<usize>,
    pub auth: Option<SourceAuthParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<String>,
    pub row_count_hint: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreview {
    pub source_name: String,
    pub columns: Vec<String>,
    pub sample_rows: Vec<HashMap<String, String>>,
    pub total_estimated_rows: Option<usize>,
    pub tables: Vec<TableSchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshot {
    pub source_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
    pub delimiter_label: String,
}

pub trait DataSource: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn list_tables(&self) -> Result<Vec<TableSchema>, String>;
    fn preview(&self, table_or_query: &str, limit: usize) -> Result<SourcePreview, String>;
    fn extract_snapshot(&self, table_or_query: &str) -> Result<SourceSnapshot, String>;
}

fn json_value_to_cell(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Parsea texto JSON tabular (array de objetos, o `{ data | results | items | rows | value: [...] }`)
pub fn parse_json_tabular(
    source_name: &str,
    raw: &str,
    limit: Option<usize>,
) -> Result<SourcePreview, String> {
    let val: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("JSON inválido: {}", e))?;

    let rows_slice: Vec<&serde_json::Value> = if let Some(arr) = val.as_array() {
        arr.iter().collect()
    } else if let Some(obj) = val.as_object() {
        let mut found: Option<&Vec<serde_json::Value>> = None;
        for key in ["data", "results", "items", "rows", "value", "records"] {
            if let Some(arr) = obj.get(key).and_then(|v| v.as_array()) {
                found = Some(arr);
                break;
            }
        }
        if let Some(arr) = found {
            arr.iter().collect()
        } else {
            vec![&val]
        }
    } else {
        return Err("El JSON no contiene objetos ni arreglos tabulares.".to_string());
    };

    let total = rows_slice.len();
    let max_take = limit.unwrap_or(total).min(total);

    let mut col_set: BTreeSet<String> = BTreeSet::new();
    let mut columns: Vec<String> = Vec::new();
    let mut sample_rows: Vec<HashMap<String, String>> = Vec::with_capacity(max_take);

    for item in rows_slice.iter().take(max_take) {
        if let Some(obj) = item.as_object() {
            let mut row = HashMap::new();
            for (k, v) in obj {
                if col_set.insert(k.clone()) {
                    columns.push(k.clone());
                }
                row.insert(k.clone(), json_value_to_cell(v));
            }
            sample_rows.push(row);
        }
    }

    if columns.is_empty() && total > 0 {
        columns.push("Valor".to_string());
        for item in rows_slice.iter().take(max_take) {
            let mut row = HashMap::new();
            row.insert("Valor".to_string(), json_value_to_cell(item));
            sample_rows.push(row);
        }
    }

    for row in &mut sample_rows {
        for c in &columns {
            row.entry(c.clone()).or_insert_with(String::new);
        }
    }

    Ok(SourcePreview {
        source_name: source_name.to_string(),
        columns: columns.clone(),
        sample_rows,
        total_estimated_rows: Some(total),
        tables: vec![TableSchema {
            name: source_name.to_string(),
            columns,
            row_count_hint: Some(total),
        }],
    })
}

fn detect_csv_delimiter(first_line: &str) -> u8 {
    let candidates = [b',', b';', b'\t', b'|'];
    let mut best = b',';
    let mut best_count = 0usize;
    for &delim in &candidates {
        let count = first_line.as_bytes().iter().filter(|&&b| b == delim).count();
        if count > best_count {
            best_count = count;
            best = delim;
        }
    }
    best
}

pub fn parse_csv_snapshot(
    source_name: &str,
    raw: &str,
    limit: Option<usize>,
) -> Result<SourcePreview, String> {
    let first_line = raw.lines().next().unwrap_or("");
    let delim = detect_csv_delimiter(first_line);

    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delim)
        .flexible(true)
        .from_reader(raw.as_bytes());

    let headers_rec = rdr.headers().map_err(|e| format!("Error leyendo encabezados CSV: {}", e))?;
    let mut columns: Vec<String> = headers_rec
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let t = h.trim();
            if t.is_empty() {
                format!("Columna_{}", i + 1)
            } else {
                t.to_string()
            }
        })
        .collect();

    if columns.is_empty() {
        return Err("El archivo CSV está vacío.".to_string());
    }

    // Deduplicar encabezados repetidos
    let mut seen: HashMap<String, usize> = HashMap::new();
    for col in &mut columns {
        let count = seen.entry(col.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            *col = format!("{}_{}", col, count);
        }
    }

    let mut sample_rows: Vec<HashMap<String, String>> = Vec::new();
    let mut total_count = 0usize;

    for result in rdr.records() {
        let rec = result.map_err(|e| format!("Error leyendo fila CSV: {}", e))?;
        total_count += 1;
        if limit.map_or(true, |l| sample_rows.len() < l) {
            let mut row = HashMap::new();
            for (i, col) in columns.iter().enumerate() {
                row.insert(col.clone(), rec.get(i).unwrap_or("").to_string());
            }
            sample_rows.push(row);
        }
    }

    Ok(SourcePreview {
        source_name: source_name.to_string(),
        columns: columns.clone(),
        sample_rows,
        total_estimated_rows: Some(total_count),
        tables: vec![TableSchema {
            name: source_name.to_string(),
            columns,
            row_count_hint: Some(total_count),
        }],
    })
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    decode_html_entities(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_tag_blocks<'a>(html: &'a str, tag: &str) -> Vec<&'a str> {
    let lower = html.to_ascii_lowercase();
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let mut results = Vec::new();
    let mut cursor = 0usize;

    while let Some(rel_start) = lower[cursor..].find(&open_pat) {
        let start = cursor + rel_start;
        let after_open = start + open_pat.len();
        let Some(tag_end_rel) = lower[after_open..].find('>') else {
            break;
        };
        let content_start = after_open + tag_end_rel + 1;
        if let Some(rel_close) = lower[content_start..].find(&close_pat) {
            let content_end = content_start + rel_close;
            results.push(&html[content_start..content_end]);
            cursor = content_end + close_pat.len();
        } else {
            break;
        }
    }
    results
}

fn extract_row_cells(tr_html: &str) -> Vec<(bool, String)> {
    let lower = tr_html.to_ascii_lowercase();
    let mut cells = Vec::new();
    let mut cursor = 0usize;

    while cursor < lower.len() {
        let next_td = lower[cursor..].find("<td");
        let next_th = lower[cursor..].find("<th");
        let (is_header, rel_pos) = match (next_td, next_th) {
            (Some(a), Some(b)) => {
                if a < b {
                    (false, a)
                } else {
                    (true, b)
                }
            }
            (Some(a), None) => (false, a),
            (None, Some(b)) => (true, b),
            (None, None) => break,
        };

        let start = cursor + rel_pos;
        let Some(open_end_rel) = lower[start..].find('>') else {
            break;
        };
        let content_start = start + open_end_rel + 1;
        let close_tag = if is_header { "</th>" } else { "</td>" };
        let Some(close_rel) = lower[content_start..].find(close_tag) else {
            break;
        };
        let content_end = content_start + close_rel;
        let text = strip_html_tags(&tr_html[content_start..content_end]);
        cells.push((is_header, text));
        cursor = content_end + close_tag.len();
    }

    cells
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedHtmlTable {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
}

/// Extrae todas las tablas HTML (`<table>`) útiles de una página web o artículo de Wikipedia
pub fn parse_html_tables(html: &str) -> Vec<ParsedHtmlTable> {
    let tables = extract_tag_blocks(html, "table");
    let mut parsed_tables = Vec::new();

    for (t_idx, table_html) in tables.into_iter().enumerate() {
        let trs = extract_tag_blocks(table_html, "tr");
        if trs.len() < 2 {
            continue;
        }

        let mut columns: Vec<String> = Vec::new();
        let mut data_rows: Vec<HashMap<String, String>> = Vec::new();

        for (r_idx, tr) in trs.iter().enumerate() {
            let cells = extract_row_cells(tr);
            if cells.is_empty() {
                continue;
            }
            if columns.is_empty() && (r_idx == 0 || cells.iter().all(|(is_h, _)| *is_h)) {
                let mut seen: HashMap<String, usize> = HashMap::new();
                for (c_idx, (_, text)) in cells.iter().enumerate() {
                    let base = if text.is_empty() {
                        format!("Columna_{}", c_idx + 1)
                    } else {
                        text.clone()
                    };
                    let count = seen.entry(base.clone()).or_insert(0);
                    *count += 1;
                    columns.push(if *count > 1 {
                        format!("{}_{}", base, count)
                    } else {
                        base
                    });
                }
                continue;
            }

            if columns.is_empty() {
                continue;
            }

            let mut row = HashMap::new();
            for (c_idx, col) in columns.iter().enumerate() {
                let val = cells.get(c_idx).map(|(_, t)| t.clone()).unwrap_or_default();
                row.insert(col.clone(), val);
            }
            if row.values().any(|v| !v.is_empty()) {
                data_rows.push(row);
            }
        }

        if columns.len() >= 2 && !data_rows.is_empty() {
            let caption = extract_tag_blocks(table_html, "caption")
                .first()
                .map(|c| strip_html_tags(c))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("Tabla {}", parsed_tables.len() + 1));

            let _ = t_idx;
            parsed_tables.push(ParsedHtmlTable {
                name: caption,
                columns,
                rows: data_rows,
            });
        }
    }

    parsed_tables
}

/// Valida que la instrucción SQL opcional sea únicamente de lectura (SELECT / WITH)
pub fn validate_sql_read_only(query: &str) -> Result<(), String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let upper = trimmed.to_ascii_uppercase();
    if !(upper.starts_with("SELECT") || upper.starts_with("WITH")) {
        return Err("Por seguridad, solo se permiten consultas de lectura (SELECT / WITH).".to_string());
    }
    for forbidden in ["DROP ", "DELETE ", "TRUNCATE ", "ALTER ", "UPDATE ", "INSERT ", "EXEC "] {
        if upper.contains(forbidden) {
            return Err(format!(
                "Operación no permitida en estación de lectura: '{}'",
                forbidden.trim()
            ));
        }
    }
    Ok(())
}

/// Construye la consulta de previsualización limitada según el dialecto SQL
pub fn build_sql_preview_query(dialect: &SqlDialect, table_or_query: &str, limit: usize) -> String {
    let q = table_or_query.trim();
    if q.to_ascii_uppercase().starts_with("SELECT") || q.to_ascii_uppercase().starts_with("WITH") {
        return q.to_string();
    }
    match dialect {
        SqlDialect::Sqlserver => format!("SELECT TOP {} * FROM {}", limit, q),
        SqlDialect::Postgres | SqlDialect::Mysql => format!("SELECT * FROM {} LIMIT {}", q, limit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_tabular_wrapper() {
        let json = r#"{"data":[{"id":1,"ciudad":"Villahermosa"},{"id":2,"ciudad":"Mérida","extra":true}]}"#;
        let preview = parse_json_tabular("API_Test", json, Some(10)).unwrap();
        assert_eq!(preview.columns.len(), 3);
        assert!(preview.columns.contains(&"id".to_string()));
        assert!(preview.columns.contains(&"ciudad".to_string()));
        assert!(preview.columns.contains(&"extra".to_string()));
        assert_eq!(preview.sample_rows.len(), 2);
        assert_eq!(preview.sample_rows[0]["extra"], "");
        assert_eq!(preview.sample_rows[1]["extra"], "true");
    }

    #[test]
    fn test_parse_html_tables_wikipedia_style() {
        let html = r#"
        <html><body>
          <table>
            <caption>Municipios de Tabasco</caption>
            <tr><th>Clave</th><th>Municipio</th><th>Cabecera</th></tr>
            <tr><td>004</td><td>Centro</td><td>Villahermosa</td></tr>
            <tr><td>005</td><td>Comalcalco</td><td>Comalcalco</td></tr>
          </table>
        </body></html>"#;
        let tables = parse_html_tables(html);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "Municipios de Tabasco");
        assert_eq!(tables[0].columns, vec!["Clave", "Municipio", "Cabecera"]);
        assert_eq!(tables[0].rows.len(), 2);
        assert_eq!(tables[0].rows[0]["Cabecera"], "Villahermosa");
    }

    #[test]
    fn test_sql_safety_and_dialect_preview() {
        assert!(validate_sql_read_only("SELECT * FROM Clientes").is_ok());
        assert!(validate_sql_read_only("DROP TABLE Clientes").is_err());
        assert_eq!(
            build_sql_preview_query(&SqlDialect::Sqlserver, "dbo.Clientes", 100),
            "SELECT TOP 100 * FROM dbo.Clientes"
        );
        assert_eq!(
            build_sql_preview_query(&SqlDialect::Postgres, "public.clientes", 100),
            "SELECT * FROM public.clientes LIMIT 100"
        );
    }
}
