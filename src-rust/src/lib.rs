use calamine::{open_workbook_auto, Data, Reader};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub mod duckdb_engine;
pub mod sources;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClusterMethod {
    Fingerprint,
    #[serde(rename = "N-gram")]
    Ngram,
    #[serde(rename = "Fonético ES")]
    FoneticoEs,
    Levenshtein,
    Abreviatura,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterVariant {
    pub value: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterGroup {
    pub id: String,
    pub method: ClusterMethod,
    pub suggested_canonical: String,
    pub variants: Vec<ClusterVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SplitNameResult {
    pub nombres: String,
    pub apellido_paterno: String,
    pub apellido_materno: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedWindow {
    pub total_rows: usize,
    pub offset: usize,
    pub limit: usize,
    pub rows: Vec<HashMap<String, String>>,
}

/// Quita acentos/diacríticos Unicode (NFD)
pub fn strip_diacritics(input: &str) -> String {
    input
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
}

/// 1. Fingerprint: minúsculas, sin acentos, sin puntuación, palabras ordenadas y únicas
pub fn fingerprint_key(val: &str) -> String {
    let clean = strip_diacritics(&val.to_lowercase())
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>();
    let tokens: BTreeSet<&str> = clean.split_whitespace().collect();
    tokens.into_iter().collect::<Vec<_>>().join(" ")
}

/// 2. N-gram Fingerprint (bigramas ordenados y deduplicados)
pub fn ngram_fingerprint_key(val: &str, n: usize) -> String {
    let clean: Vec<char> = strip_diacritics(&val.to_lowercase())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if clean.len() <= n {
        return clean.into_iter().collect();
    }
    let mut grams: BTreeSet<String> = BTreeSet::new();
    for window in clean.windows(n) {
        grams.insert(window.iter().collect());
    }
    grams.into_iter().collect::<Vec<_>>().join("")
}

/// 3. Fonético en Español (Soundex / Metaphone ES)
pub fn spanish_phonetic_key(val: &str) -> String {
    let lower = strip_diacritics(&val.to_lowercase());
    let s = lower
        .replace("ll", "y")
        .replace("qu", "k")
        .replace("ce", "se")
        .replace("ci", "si")
        .replace("ge", "je")
        .replace("gi", "ji");

    let mut out = String::with_capacity(s.len());
    let mut prev: Option<char> = None;

    for ch in s.chars() {
        if !ch.is_ascii_alphabetic() {
            continue;
        }
        let mapped = match ch {
            'h' => continue,
            'v' => 'b',
            'z' => 's',
            'c' => 'k',
            'x' => 'j',
            other => other,
        };
        if prev != Some(mapped) {
            out.push(mapped);
            prev = Some(mapped);
        }
    }
    out
}

/// 4. Subsecuencia consonántica / Abreviaturas (ej. Vhsa <-> Villahermosa)
pub fn is_consonant_abbrev(short_str: &str, long_str: &str) -> bool {
    let s: Vec<char> = strip_diacritics(&short_str.to_lowercase())
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();
    let l: Vec<char> = strip_diacritics(&long_str.to_lowercase())
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();

    if s.len() < 2 || s.len() + 1 >= l.len() || s[0] != l[0] {
        return false;
    }
    if s.len() == 2 && !short_str.contains('.') {
        return false;
    }
    let mut j = 0;
    for &ch in &l {
        if ch == s[j] {
            j += 1;
            if j == s.len() {
                return true;
            }
        }
    }
    false
}

/// Ejecuta los 5 algoritmos de clustering en paralelo sobre los valores únicos de la faceta (U)
pub fn cluster_unique_facets(column: &str, facets: &[(String, usize)]) -> Vec<ClusterGroup> {
    let n = facets.len();
    if n < 2 {
        return Vec::new();
    }

    let pairs: Vec<(usize, usize, ClusterMethod)> = (0..n)
        .into_par_iter()
        .flat_map(|i| {
            let a = &facets[i].0;
            let fp_a = fingerprint_key(a);
            let ng_a = ngram_fingerprint_key(a, 2);
            let ph_a = spanish_phonetic_key(a);
            let norm_a: String = strip_diacritics(&a.to_lowercase())
                .chars()
                .filter(|c| c.is_ascii_alphabetic())
                .collect();
            let has_digit_a = a.chars().any(|c| c.is_ascii_digit());

            ((i + 1)..n)
                .filter_map(|j| {
                    let b = &facets[j].0;
                    let fp_b = fingerprint_key(b);

                    if !fp_a.is_empty() && fp_a == fp_b {
                        return Some((i, j, ClusterMethod::Fingerprint));
                    }
                    if has_digit_a || b.chars().any(|c| c.is_ascii_digit()) {
                        return None;
                    }

                    let ng_b = ngram_fingerprint_key(b, 2);
                    if ng_a.len() >= 5 && ng_a == ng_b {
                        return Some((i, j, ClusterMethod::Ngram));
                    }

                    let ph_b = spanish_phonetic_key(b);
                    if ph_a.len() >= 4 && ph_a == ph_b {
                        return Some((i, j, ClusterMethod::FoneticoEs));
                    }

                    let norm_b: String = strip_diacritics(&b.to_lowercase())
                        .chars()
                        .filter(|c| c.is_ascii_alphabetic())
                        .collect();
                    if norm_a.len() >= 4
                        && norm_b.len() >= 4
                        && strsim::levenshtein(&norm_a, &norm_b) <= 2
                    {
                        return Some((i, j, ClusterMethod::Levenshtein));
                    }

                    if is_consonant_abbrev(a, b) || is_consonant_abbrev(b, a) {
                        return Some((i, j, ClusterMethod::Abreviatura));
                    }
                    None
                })
                .collect::<Vec<_>>()
        })
        .collect();

    let mut parent: Vec<usize> = (0..n).collect();
    let mut method_map: HashMap<usize, ClusterMethod> = HashMap::new();

    fn find(parent: &mut [usize], x: usize) -> usize {
        if parent[x] != x {
            parent[x] = find(parent, parent[x]);
        }
        parent[x]
    }

    for (a, b, method) in pairs {
        let ra = find(&mut parent, a);
        let rb = find(&mut parent, b);
        if ra != rb {
            parent[rb] = ra;
            method_map.entry(ra).or_insert(method);
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }

    let mut out = Vec::new();
    for (root, indices) in groups {
        if indices.len() < 2 {
            continue;
        }
        let variants: Vec<ClusterVariant> = indices
            .iter()
            .map(|&idx| ClusterVariant {
                value: facets[idx].0.clone(),
                count: facets[idx].1,
            })
            .collect();

        let suggested_canonical = variants
            .iter()
            .max_by_key(|v| (!v.value.contains('.'), v.count))
            .map(|v| v.value.trim().to_string())
            .unwrap_or_default();

        out.push(ClusterGroup {
            id: format!("cluster_{}_{}", column, root),
            method: method_map.remove(&root).unwrap_or(ClusterMethod::Fingerprint),
            suggested_canonical,
            variants,
        });
    }
    out
}

/// Separador inteligente de nombres latinoamericanos en las 3 columnas clásicas
pub fn split_latin_american_name(raw: &str) -> SplitNameResult {
    let words: Vec<&str> = raw.split_whitespace().collect();
    if words.is_empty() {
        return SplitNameResult {
            nombres: String::new(),
            apellido_paterno: String::new(),
            apellido_materno: String::new(),
        };
    }

    let connectors: HashSet<&str> = [
        "de", "del", "la", "las", "los", "san", "santa", "y", "vda", "vda.", "viuda", "mc", "mac",
    ]
    .into_iter()
    .collect();

    let second_names: HashSet<&str> = [
        "carlos", "luis", "miguel", "angel", "fernanda", "fernando", "alberto", "antonio",
        "manuel", "jose", "maria", "guadalupe", "sofia", "elena", "isabel", "alejandro",
        "alejandra", "eduardo", "enrique", "francisco", "javier", "daniel", "daniela", "pablo",
        "paola", "andrea", "gabriela", "carmen", "rosa", "luz", "jesus", "arturo", "armando",
        "cesar", "david", "emilio", "esteban", "fabiola", "gerardo", "hector", "hugo", "ignacio",
        "ivan", "jorge", "julio", "laura", "leticia", "liliana", "lorena", "lucia", "martha",
        "martin", "mauricio", "monica", "natalia", "norma", "oscar", "patricia", "paul", "pedro",
        "rafael", "omar", "ramon", "raul", "ricardo", "roberto", "rocio", "rodolfo", "rodrigo",
        "ruben", "salvador", "sandra", "santiago", "sergio", "silvia", "teresa", "veronica",
        "victor", "victoria", "ximena", "yolanda",
    ]
    .into_iter()
    .collect();

    let mut blocks: Vec<String> = Vec::new();
    let mut prefix_buf: Vec<&str> = Vec::new();

    for (i, &w) in words.iter().enumerate() {
        let norm = strip_diacritics(&w.to_lowercase());
        if connectors.contains(norm.as_str()) && i + 1 < words.len() {
            prefix_buf.push(w);
        } else if !prefix_buf.is_empty() {
            prefix_buf.push(w);
            let combined = prefix_buf.join(" ");
            prefix_buf.clear();
            blocks.push(combined);
        } else {
            blocks.push(w.to_string());
        }
    }
    if !prefix_buf.is_empty() {
        blocks.push(prefix_buf.join(" "));
    }

    match blocks.len() {
        1 => SplitNameResult {
            nombres: blocks[0].clone(),
            apellido_paterno: String::new(),
            apellido_materno: String::new(),
        },
        2 => SplitNameResult {
            nombres: blocks[0].clone(),
            apellido_paterno: blocks[1].clone(),
            apellido_materno: String::new(),
        },
        3 => {
            let second_norm = strip_diacritics(&blocks[1].to_lowercase());
            if !blocks[0].contains(' ') && second_names.contains(second_norm.as_str()) {
                SplitNameResult {
                    nombres: format!("{} {}", blocks[0], blocks[1]),
                    apellido_paterno: blocks[2].clone(),
                    apellido_materno: String::new(),
                }
            } else {
                SplitNameResult {
                    nombres: blocks[0].clone(),
                    apellido_paterno: blocks[1].clone(),
                    apellido_materno: blocks[2].clone(),
                }
            }
        }
        len => SplitNameResult {
            nombres: blocks[..len - 2].join(" "),
            apellido_paterno: blocks[len - 2].clone(),
            apellido_materno: blocks[len - 1].clone(),
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColumnProfileResult {
    pub column: String,
    pub total_rows: usize,
    pub empty_count: usize,
    pub error_count: usize,
    pub control_char_count: usize,
    pub unique_non_empty: usize,
    pub duplicate_rows: usize,
}

/// Limpia caracteres de control invisibles, NBSP y colapsa espacios múltiples
pub fn deep_clean_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = true;
    for ch in input.chars() {
        if matches!(ch, '\u{0000}'..='\u{0008}' | '\u{000B}' | '\u{000C}' | '\u{000E}'..='\u{001F}' | '\u{007F}' | '\u{200B}'..='\u{200D}' | '\u{FEFF}') {
            continue;
        }
        if ch.is_whitespace() || ch == '\u{00A0}' {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

pub fn is_error_cell(val: &str) -> bool {
    let t = val.trim();
    matches!(
        t.to_ascii_uppercase().as_str(),
        "#ERROR!" | "#N/A" | "#VALUE!" | "#REF!" | "#DIV/0!" | "#NAME?" | "#NUM!" | "#NULL!"
    )
}

/// Perfilado rápido en paralelo de calidad y duplicados para una columna
pub fn profile_column_values(column: &str, values: &[String]) -> ColumnProfileResult {
    let total_rows = values.len();
    let (empty_count, error_count, control_char_count) = values
        .par_iter()
        .fold(
            || (0usize, 0usize, 0usize),
            |mut acc, v| {
                if v.trim().is_empty() {
                    acc.0 += 1;
                } else {
                    if is_error_cell(v) {
                        acc.1 += 1;
                    }
                    if v.chars().any(|c| c.is_control() || matches!(c, '\u{00A0}' | '\u{200B}'..='\u{200D}' | '\u{FEFF}')) {
                        acc.2 += 1;
                    }
                }
                acc
            },
        )
        .reduce(
            || (0, 0, 0),
            |a, b| (a.0 + b.0, a.1 + b.1, a.2 + b.2),
        );

    let mut counts: HashMap<&str, usize> = HashMap::new();
    for v in values {
        if !v.trim().is_empty() {
            *counts.entry(v.as_str()).or_insert(0) += 1;
        }
    }
    let unique_non_empty = counts.len();
    let duplicate_rows: usize = counts.values().filter(|&&c| c > 1).map(|&c| c - 1).sum();

    ColumnProfileResult {
        column: column.to_string(),
        total_rows,
        empty_count,
        error_count,
        control_char_count,
        unique_non_empty,
        duplicate_rows,
    }
}

/// Paginación virtualizada para ventanas de alta densidad (500k+ filas)
pub fn paginate_rows(
    rows: &[HashMap<String, String>],
    offset: usize,
    limit: usize,
) -> PaginatedWindow {
    let total_rows = rows.len();
    let start = offset.min(total_rows);
    let end = (start + limit).min(total_rows);
    PaginatedWindow {
        total_rows,
        offset: start,
        limit,
        rows: rows[start..end].to_vec(),
    }
}

/// Lectura nativa de hojas Excel (.xlsx, .ods, .xls) mediante calamine
pub fn read_excel_sheet(
    path: &str,
    sheet_name: Option<&str>,
) -> Result<(Vec<String>, Vec<Vec<String>>, Vec<String>), String> {
    let mut workbook = open_workbook_auto(path).map_err(|e| e.to_string())?;
    let sheets = workbook.sheet_names().to_owned();
    let target_sheet = sheet_name
        .map(|s| s.to_string())
        .or_else(|| sheets.first().cloned())
        .ok_or_else(|| "El archivo Excel no contiene hojas".to_string())?;

    let range = workbook
        .worksheet_range(&target_sheet)
        .map_err(|e| e.to_string())?;

    let mut rows_iter = range.rows();
    let header_cells = match rows_iter.next() {
        Some(h) => h,
        None => return Ok((Vec::new(), Vec::new(), sheets)),
    };

    let headers: Vec<String> = header_cells
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let s = cell_to_string(c).trim().to_string();
            if s.is_empty() {
                format!("Columna_{}", i + 1)
            } else {
                s
            }
        })
        .collect();

    let rows: Vec<Vec<String>> = rows_iter
        .map(|r| r.iter().map(cell_to_string).collect())
        .collect();

    Ok((headers, rows, sheets))
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{:.0}", f)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt.to_string(),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{:?}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_five_clustering_algorithms_in_spanish() {
        let facets = vec![
            ("Villahermosa".to_string(), 5),
            ("Biya Hermosa".to_string(), 2),
            ("Vhsa".to_string(), 3),
            ("hermosa villa".to_string(), 1),
            ("Guadalajara".to_string(), 4),
            ("Guadalaraja".to_string(), 1),
            ("Gdl".to_string(), 2),
            ("Xalapa".to_string(), 3),
            ("Jalapa".to_string(), 2),
        ];
        let clusters = cluster_unique_facets("Ciudad", &facets);
        assert_eq!(clusters.len(), 3);
    }

    #[test]
    fn test_split_latin_american_names() {
        let n1 = split_latin_american_name("ana lópez pérez");
        assert_eq!(n1.nombres, "ana");
        assert_eq!(n1.apellido_paterno, "lópez");
        assert_eq!(n1.apellido_materno, "pérez");

        let n2 = split_latin_american_name("JUAN CARLOS MÉNDEZ");
        assert_eq!(n2.nombres, "JUAN CARLOS");
        assert_eq!(n2.apellido_paterno, "MÉNDEZ");
        assert_eq!(n2.apellido_materno, "");

        let n3 = split_latin_american_name("Patricia de la Cruz Ríos");
        assert_eq!(n3.nombres, "Patricia");
        assert_eq!(n3.apellido_paterno, "de la Cruz");
        assert_eq!(n3.apellido_materno, "Ríos");
    }

    #[test]
    fn test_profile_column_and_deep_clean() {
        assert_eq!(deep_clean_text("  Hola\u{00A0}\t mundo\u{200B}\n  "), "Hola mundo");
        let vals = vec![
            "CDMX".to_string(),
            "CDMX".to_string(),
            "".to_string(),
            "#ERROR!".to_string(),
            "Tabasco\u{00A0}".to_string(),
        ];
        let prof = profile_column_values("Ciudad", &vals);
        assert_eq!(prof.total_rows, 5);
        assert_eq!(prof.empty_count, 1);
        assert_eq!(prof.error_count, 1);
        assert_eq!(prof.control_char_count, 1);
        assert_eq!(prof.unique_non_empty, 3);
        assert_eq!(prof.duplicate_rows, 1);
    }
}
