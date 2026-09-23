// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

mod input;
mod server;
mod sets;

use server::Shared;
use sets::{SetEntry, SetsIndex};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

const PROFILE_FILE: &str = "profile.json";
const FRAMES_DIR: &str = "frames";
/// Settings shared across all sets (mic tuning etc.), in `<appData>/global.json`.
const GLOBAL_FILE: &str = "global.json";

/// Everything the commands need. Profile content is opaque JSON owned by the
/// frontend; Rust only stores it and serves the frame files next to it.
struct AppState {
    shared: Shared,
    input_filter: input::SharedFilter,
    /// `<appData>/profiles` — parent of every set folder plus `sets.json`.
    profiles_root: PathBuf,
    /// `<appData>` — holds `global.json` (settings shared across sets).
    data_dir: PathBuf,
}

fn profile_dir_sync(shared: &Shared) -> PathBuf {
    shared.profile_dir.blocking_read().clone()
}

/// Point the frame server + frame commands at a different set's folder.
fn set_active_dir(shared: &Shared, dir: PathBuf) {
    *shared.profile_dir.blocking_write() = dir;
}

/// Frame keys are `<layerId>.<variantId>.<frameKey>` (dots separate the parts).
fn frame_key_ok(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('.')
        && !key.ends_with('.')
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Frame files are `<layerId>.<variantId>.<frameKey>.png`. Older layouts are
/// renamed in place: M1 stored them flat (`idle.png`) and the first layer
/// model omitted the variant (`main.idle.png`). Targets match the frontend's
/// BASE_LAYER_ID ('main') and DEFAULT_VARIANT_ID ('default') in types.ts.
fn migrate_frame_files(frames_dir: &Path) {
    // M1 flat (`idle.png`) and first layer-model (`main.idle.png`) → main.default.<frame>.
    for frame in ["idle", "talking", "idle-blink", "talking-blink"] {
        for old_name in [format!("{frame}.png"), format!("main.{frame}.png")] {
            let old = frames_dir.join(&old_name);
            let new = frames_dir.join(format!("main.default.{frame}.png"));
            if old.exists() && !new.exists() {
                match std::fs::rename(&old, &new) {
                    Ok(()) => log::info!("migrated frame {old_name} -> main.default.{frame}.png"),
                    Err(e) => log::warn!("frame migration failed for {old_name}: {e}"),
                }
            }
        }
    }
    // "blink" frames were renamed to "timed" (v1): <prefix>.idle-blink.png ->
    // <prefix>.idle-timed.png (and talking-blink), across all layers/variants.
    if let Ok(entries) = std::fs::read_dir(frames_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let renamed = name
                .strip_suffix(".idle-blink.png")
                .map(|b| format!("{b}.idle-timed.png"))
                .or_else(|| {
                    name.strip_suffix(".talking-blink.png")
                        .map(|b| format!("{b}.talking-timed.png"))
                });
            if let Some(new_name) = renamed {
                let new = frames_dir.join(&new_name);
                if !new.exists() {
                    match std::fs::rename(entry.path(), &new) {
                        Ok(()) => log::info!("migrated frame {name} -> {new_name}"),
                        Err(e) => log::warn!("frame migration failed for {name}: {e}"),
                    }
                }
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

/// Frontend registers which triggers are bound; the input listeners drop
/// everything else (see input.rs privacy design).
#[tauri::command]
fn set_bound_triggers(state: State<AppState>, triggers: Vec<String>) {
    state.input_filter.lock().unwrap().bound = triggers.into_iter().collect();
}

/// Binding editor: forward the next key/button press once as `input-capture`.
#[tauri::command]
fn set_trigger_capture(state: State<AppState>, on: bool) {
    state.input_filter.lock().unwrap().capturing = on;
}

#[tauri::command]
fn profile_path(state: State<AppState>) -> String {
    profile_dir_sync(&state.shared).to_string_lossy().into_owned()
}

// --- Sets: each set is a self-contained avatar (its own profile + frames). ---

/// The set registry: which sets exist and which is active.
#[tauri::command]
fn list_sets(state: State<AppState>) -> SetsIndex {
    sets::read_index(&state.profiles_root)
}

/// Bundled default avatars a new set can be seeded from.
#[tauri::command]
fn default_avatars() -> Vec<String> {
    sets::bundled_names()
}

/// Overwrite the active set's character frames with a bundled avatar's, leaving
/// accessory-layer frames untouched. Returns the present frame keys.
#[tauri::command]
fn apply_default(state: State<AppState>, name: String) -> Result<Vec<String>, String> {
    let frames = profile_dir_sync(&state.shared).join(FRAMES_DIR);
    std::fs::create_dir_all(&frames).map_err(|e| format!("mkdir {}: {e}", frames.display()))?;
    sets::seed_from_bundled(&frames, &name)?;
    list_frames_in(&frames)
}

/// Create a new set. `from` is `blank`, `default:<name>`, or `copy:<setId>`.
/// Returns the new set's id. Does not switch to it.
#[tauri::command]
fn create_set(state: State<AppState>, name: String, from: String) -> Result<String, String> {
    let mut idx = sets::read_index(&state.profiles_root);
    let id = sets::gen_id(&idx);
    sets::create_set_files(&state.profiles_root, &id, &from)?;
    idx.sets.push(SetEntry { id: id.clone(), name });
    sets::write_index(&state.profiles_root, &idx)?;
    Ok(id)
}

/// Make `id` the active set: the frame server and frame commands follow.
#[tauri::command]
fn switch_set(state: State<AppState>, id: String) -> Result<(), String> {
    if !sets::id_ok(&id) {
        return Err(format!("invalid set id {id:?}"));
    }
    let mut idx = sets::read_index(&state.profiles_root);
    if !idx.sets.iter().any(|s| s.id == id) {
        return Err(format!("no set {id:?}"));
    }
    idx.active = id.clone();
    sets::write_index(&state.profiles_root, &idx)?;
    let dir = sets::set_dir(&state.profiles_root, &id);
    std::fs::create_dir_all(dir.join(FRAMES_DIR)).map_err(|e| e.to_string())?;
    migrate_frame_files(&dir.join(FRAMES_DIR));
    set_active_dir(&state.shared, dir);
    Ok(())
}

#[tauri::command]
fn rename_set(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    let mut idx = sets::read_index(&state.profiles_root);
    let Some(entry) = idx.sets.iter_mut().find(|s| s.id == id) else {
        return Err(format!("no set {id:?}"));
    };
    entry.name = name;
    sets::write_index(&state.profiles_root, &idx)
}

/// Delete a set (never the last one). Returns the id that is active afterward.
#[tauri::command]
fn delete_set(state: State<AppState>, id: String) -> Result<String, String> {
    if !sets::id_ok(&id) {
        return Err(format!("invalid set id {id:?}"));
    }
    let mut idx = sets::read_index(&state.profiles_root);
    if idx.sets.len() <= 1 {
        return Err("can't delete the last set".into());
    }
    if !idx.sets.iter().any(|s| s.id == id) {
        return Err(format!("no set {id:?}"));
    }
    idx.sets.retain(|s| s.id != id);
    sets::remove_set_dir(&state.profiles_root, &id)?;
    if idx.active == id {
        idx.active = idx.sets[0].id.clone();
        let dir = sets::set_dir(&state.profiles_root, &idx.active);
        std::fs::create_dir_all(dir.join(FRAMES_DIR)).map_err(|e| e.to_string())?;
        migrate_frame_files(&dir.join(FRAMES_DIR));
        set_active_dir(&state.shared, dir);
    }
    sets::write_index(&state.profiles_root, &idx)?;
    Ok(idx.active)
}

/// Settings shared across sets (mic tuning). Opaque JSON owned by the frontend.
#[tauri::command]
fn load_global(state: State<AppState>) -> Result<Option<serde_json::Value>, String> {
    let path = state.data_dir.join(GLOBAL_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map(Some).map_err(|e| format!("parse {}: {e}", path.display()))
}

#[tauri::command]
fn save_global(state: State<AppState>, value: serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    let path = state.data_dir.join(GLOBAL_FILE);
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Ensure `sets.json` exists and return the active set's directory. Migrates an
/// existing single `default` profile into the registry, or seeds a fresh
/// install with a starter avatar so the app is never empty.
fn init_sets(profiles_root: &Path) -> PathBuf {
    let mut idx = sets::read_index(profiles_root);
    if idx.sets.is_empty() {
        let default_dir = sets::set_dir(profiles_root, "default");
        let legacy =
            default_dir.join(PROFILE_FILE).exists() || default_dir.join(FRAMES_DIR).exists();
        if !legacy {
            if let Err(e) = sets::create_set_files(profiles_root, "default", "default:cat") {
                log::warn!("could not seed starter set: {e}");
                let _ = std::fs::create_dir_all(default_dir.join(FRAMES_DIR));
            }
        }
        idx = SetsIndex {
            active: "default".into(),
            sets: vec![SetEntry { id: "default".into(), name: "My avatar".into() }],
        };
        if let Err(e) = sets::write_index(profiles_root, &idx) {
            log::warn!("could not write sets.json: {e}");
        }
    }
    // Repair a dangling active pointer (set removed out from under us).
    if !idx.sets.iter().any(|s| s.id == idx.active) {
        if let Some(first) = idx.sets.first() {
            idx.active = first.id.clone();
            let _ = sets::write_index(profiles_root, &idx);
        }
    }
    sets::set_dir(profiles_root, &idx.active)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let profiles_root = data_dir.join("profiles");
            std::fs::create_dir_all(&profiles_root)?;
            let active_dir = init_sets(&profiles_root);
            std::fs::create_dir_all(active_dir.join(FRAMES_DIR))?;
            migrate_frame_files(&active_dir.join(FRAMES_DIR));
            log::info!("active set dir: {}", active_dir.display());
            let shared = Shared::new(active_dir);
            tauri::async_runtime::spawn(server::run(shared.clone(), server::DEFAULT_PORT));
            // Global input (keyboard/gamepad) is shelved for v1 — layers toggle in the
            // UI, so we don't run a global hook. Re-enable these for 2.0 hotkeys:
            //   input::spawn_keyboard(app.handle().clone(), input_filter.clone());
            //   input::spawn_gamepad(app.handle().clone(), input_filter.clone());
            let input_filter = input::SharedFilter::default();
            app.manage(AppState { shared, input_filter, profiles_root, data_dir });
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
            profile_path,
            set_bound_triggers,
            set_trigger_capture,
            list_sets,
            default_avatars,
            apply_default,
            create_set,
            switch_set,
            rename_set,
            delete_set,
            load_global,
            save_global
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
