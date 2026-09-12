// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

mod server;

use server::Shared;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const PROFILE_FILE: &str = "profile.json";
const FRAMES_DIR: &str = "frames";

/// Everything the commands need. Profile content is opaque JSON owned by the
/// frontend; Rust only stores it and serves the frame files next to it.
struct AppState {
    shared: Shared,
}

fn profile_dir_sync(shared: &Shared) -> PathBuf {
    shared.profile_dir.blocking_read().clone()
}

/// Frame keys are `<layerId>.<frameKey>` (dots separate the parts).
fn frame_key_ok(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('.')
        && !key.ends_with('.')
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// M1 stored frames flat (`idle.png`); the layer model stores them as
/// `<layerId>.<frameKey>.png`. Rename old files into the base layer the
/// frontend migrates old profiles onto (`main`, see types.ts BASE_LAYER_ID).
fn migrate_flat_frames(frames_dir: &Path) {
    for frame in ["idle", "talking", "idle-blink", "talking-blink"] {
        let old = frames_dir.join(format!("{frame}.png"));
        let new = frames_dir.join(format!("main.{frame}.png"));
        if old.exists() && !new.exists() {
            match std::fs::rename(&old, &new) {
                Ok(()) => log::info!("migrated frame {frame}.png -> main.{frame}.png"),
                Err(e) => log::warn!("frame migration failed for {frame}: {e}"),
            }
        }
    }
}

#[tauri::command]
fn load_profile(state: State<AppState>) -> Result<Option<serde_json::Value>, String> {
    let path = profile_dir_sync(&state.shared).join(PROFILE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map(Some).map_err(|e| format!("parse {}: {e}", path.display()))
}

#[tauri::command]
fn save_profile(state: State<AppState>, profile: serde_json::Value) -> Result<(), String> {
    let dir = profile_dir_sync(&state.shared);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let path = dir.join(PROFILE_FILE);
    let text = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Copy an image from anywhere on disk into the profile's frames folder as
/// `<key>.png`. Returns the list of frame keys that now have a file.
#[tauri::command]
fn import_frame(state: State<AppState>, key: String, src: String) -> Result<Vec<String>, String> {
    if !frame_key_ok(&key) {
        return Err(format!("invalid frame key {key:?}"));
    }
    let dir = profile_dir_sync(&state.shared).join(FRAMES_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let dest = dir.join(format!("{key}.png"));
    std::fs::copy(&src, &dest).map_err(|e| format!("copy {src} -> {}: {e}", dest.display()))?;
    log::info!("imported frame {key} from {src}");
    list_frames_in(&dir)
}

#[tauri::command]
fn clear_frame(state: State<AppState>, key: String) -> Result<Vec<String>, String> {
    if !frame_key_ok(&key) {
        return Err(format!("invalid frame key {key:?}"));
    }
    let dir = profile_dir_sync(&state.shared).join(FRAMES_DIR);
    let path = dir.join(format!("{key}.png"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    list_frames_in(&dir)
}

#[tauri::command]
fn list_frames(state: State<AppState>) -> Result<Vec<String>, String> {
    list_frames_in(&profile_dir_sync(&state.shared).join(FRAMES_DIR))
}

fn list_frames_in(dir: &Path) -> Result<Vec<String>, String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(vec![]) };
    let mut keys: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.strip_suffix(".png").map(str::to_owned)
        })
        .collect();
    keys.sort();
    Ok(keys)
}

/// Frontend pushes its current render state here; the server fans it out to
/// every connected OBS overlay.
#[tauri::command]
async fn publish_state(state: State<'_, AppState>, json: String) -> Result<(), String> {
    state.shared.publish(json).await;
    Ok(())
}

#[tauri::command]
fn overlay_url() -> String {
    format!("http://127.0.0.1:{}/", server::DEFAULT_PORT)
}

#[tauri::command]
fn profile_path(state: State<AppState>) -> String {
    profile_dir_sync(&state.shared).to_string_lossy().into_owned()
}

fn default_profile_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("profiles")
        .join("default")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = default_profile_dir(app.handle());
            std::fs::create_dir_all(dir.join(FRAMES_DIR))?;
            migrate_flat_frames(&dir.join(FRAMES_DIR));
            log::info!("profile dir: {}", dir.display());
            let shared = Shared::new(dir);
            tauri::async_runtime::spawn(server::run(shared.clone(), server::DEFAULT_PORT));
            app.manage(AppState { shared });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_profile,
            save_profile,
            import_frame,
            clear_frame,
            list_frames,
            publish_state,
            overlay_url,
            profile_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
