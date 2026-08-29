use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct FileMeta {
    #[serde(rename = "modifiedMs")]
    modified_ms: u128,
    size: u64,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?;

    fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create app data directory: {e}"))?;

    Ok(dir.join("projects.json"))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<String, String> {
    let path = state_path(&app)?;

    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}

#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let path = state_path(&app)?;
    let temp = path.with_extension("json.tmp");

    fs::write(&temp, json)
        .map_err(|e| format!("Could not write temporary project library: {e}"))?;

    if path.exists() {
        let _ = fs::remove_file(&path);
    }

    fs::rename(&temp, &path)
        .map_err(|e| format!("Could not save project library: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, text: String) -> Result<(), String> {
    fs::write(&path, text)
        .map_err(|e| format!("Could not write {path}: {e}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

#[tauri::command]
fn open_ioc_file(path: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".ioc") {
        return Err("Active file is not an IOC file.".into());
    }

    if !std::path::Path::new(&path).exists() {
        return Err("IOC file no longer exists at the saved path.".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not open IOC file: {e}"))?;

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Open in CubeMX is currently Windows-only.".into())
    }
}

#[tauri::command]
fn file_metadata(path: String) -> Result<FileMeta, String> {
    let meta = fs::metadata(&path)
        .map_err(|e| format!("Could not read metadata for {path}: {e}"))?;

    let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    Ok(FileMeta {
        modified_ms,
        size: meta.len(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            read_text_file,
            file_metadata,
            open_ioc_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running NucleoPin Desktop");
}