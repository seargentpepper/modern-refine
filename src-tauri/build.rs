use std::path::PathBuf;

fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    copy_duckdb_dll_to_profile_dir();
}

#[cfg(target_os = "windows")]
fn copy_duckdb_dll_to_profile_dir() {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let out_path = PathBuf::from(out_dir);
    // OUT_DIR = target/<profile>/build/<pkg>/out -> profile_dir = target/<profile>, target_dir = target
    let Some(profile_dir) = out_path.ancestors().nth(3) else {
        return;
    };
    let Some(target_dir) = profile_dir.parent() else {
        return;
    };
    let download_root = target_dir.join("duckdb-download");
    if let Some(dll_path) = find_file_recursive(&download_root, "duckdb.dll") {
        let dest = profile_dir.join("duckdb.dll");
        if !dest.exists() {
            let _ = std::fs::copy(dll_path, dest);
        }
    }
}

#[cfg(target_os = "windows")]
fn find_file_recursive(dir: &std::path::Path, filename: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file_recursive(&p, filename) {
                return Some(found);
            }
        } else if p.file_name().and_then(|n| n.to_str()) == Some(filename) {
            return Some(p);
        }
    }
    None
}
