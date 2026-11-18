use modern_refine_engine::{ClusterGroup, SplitNameResult};

#[tauri::command]
fn refine_cluster(column: &str, facets: Vec<(String, usize)>) -> Vec<ClusterGroup> {
    modern_refine_engine::cluster_unique_facets(column, &facets)
}

#[tauri::command]
fn refine_split_latin_name(full_name: &str) -> SplitNameResult {
    modern_refine_engine::split_latin_american_name(full_name)
}

#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &bytes).map_err(|e| format!("Error al escribir archivo '{}': {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            refine_cluster,
            refine_split_latin_name,
            write_export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ModernRefine tauri desktop application");
}
