// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

//! Avatar "sets": each set is a self-contained avatar (its own `profile.json`
//! and `frames/`) living in `<appData>/profiles/<id>/`. The registry of sets
//! and which one is active is kept in `<appData>/profiles/sets.json`.
//!
//! The bundled default avatars (assets/avatars/) are embedded in the binary so
//! a new set can be seeded from one without any files on disk.

use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// Bundled default avatars, embedded from the repo's `assets/avatars/`.
/// Paths look like `cat/idle.png`. Owned by the project, shipped under a
/// separate non-GPL asset license (see assets/LICENSE.md).
#[derive(RustEmbed)]
#[folder = "../assets/avatars/"]
struct BundledAvatars;

const SETS_FILE: &str = "sets.json";
const FRAMES_DIR: &str = "frames";
const PROFILE_FILE: &str = "profile.json";
/// Frame files created when seeding a set from a bundled avatar.
const FRAME_KEYS: [&str; 4] = ["idle", "talking", "idle-timed", "talking-timed"];

#[derive(Serialize, Deserialize, Clone)]
pub struct SetEntry {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SetsIndex {
    pub active: String,
    pub sets: Vec<SetEntry>,
}

/// Ids become folder names, so keep them to a safe charset (no traversal).
pub fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn sets_path(root: &Path) -> PathBuf {
    root.join(SETS_FILE)
}

pub fn set_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

pub fn read_index(root: &Path) -> SetsIndex {
    std::fs::read_to_string(sets_path(root))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn write_index(root: &Path, idx: &SetsIndex) -> Result<(), String> {
    let text = serde_json::to_string_pretty(idx).map_err(|e| e.to_string())?;
    std::fs::write(sets_path(root), text).map_err(|e| format!("write sets.json: {e}"))
}

/// Names of the bundled avatars (top-level folders under assets/avatars/).
pub fn bundled_names() -> Vec<String> {
    let mut names: Vec<String> = BundledAvatars::iter()
        .filter_map(|p| p.split('/').next().map(str::to_owned))
        .collect();
    names.sort();
    names.dedup();
    names
}

static SEQ: AtomicU32 = AtomicU32::new(0);

/// A short unique id not already present in the index.
pub fn gen_id(idx: &SetsIndex) -> String {
    loop {
        let c = SEQ.fetch_add(1, Ordering::Relaxed);
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let id = format!("set_{n:x}{c:x}");
        if !idx.sets.iter().any(|s| s.id == id) {
            return id;
        }
    }
}

/// Create a set's folder and seed its frames according to `from`:
/// `blank` (empty), `default:<name>` (a bundled avatar) or `copy:<setId>`
/// (duplicate another set's profile + frames). Does not touch the index.
pub fn create_set_files(root: &Path, id: &str, from: &str) -> Result<(), String> {
    let dir = set_dir(root, id);
    let frames = dir.join(FRAMES_DIR);
    std::fs::create_dir_all(&frames).map_err(|e| format!("mkdir {}: {e}", frames.display()))?;

    if let Some(name) = from.strip_prefix("default:") {
        seed_from_bundled(&frames, name)?;
    } else if let Some(src_id) = from.strip_prefix("copy:") {
        if !id_ok(src_id) {
            return Err(format!("invalid source set id {src_id:?}"));
        }
        copy_set(&set_dir(root, src_id), &dir)?;
    } else if from != "blank" {
        return Err(format!("unknown set source {from:?}"));
    }
    Ok(())
}

/// On-disk filename for a seeded character frame. Must stay in lock-step with the
/// frontend's `frameStorageKey(BASE_LAYER_ID, DEFAULT_VARIANT_ID, fk) + ".png"`
/// (`main.default.<key>.png`) — a mismatch silently orphans bundled art. The
/// frontend side is pinned by src/lib/types.test.ts; this side by the test below.
fn seeded_frame_name(fk: &str) -> String {
    format!("main.default.{fk}.png")
}

/// Write a bundled avatar's four frames into `frames` as `main.default.<key>.png`
/// (matching the frontend's BASE_LAYER_ID / DEFAULT_VARIANT_ID). Overwrites any
/// existing character frames; other frames (accessory layers) are left alone.
pub fn seed_from_bundled(frames: &Path, name: &str) -> Result<(), String> {
    let mut wrote = 0;
    for fk in FRAME_KEYS {
        let asset = format!("{name}/{fk}.png");
        if let Some(file) = BundledAvatars::get(&asset) {
            let dest = frames.join(seeded_frame_name(fk));
            std::fs::write(&dest, file.data.into_owned())
                .map_err(|e| format!("write {}: {e}", dest.display()))?;
            wrote += 1;
        }
    }
    if wrote == 0 {
        return Err(format!("no bundled avatar named {name:?}"));
    }
    Ok(())
}

/// Duplicate a set: its profile.json (if any) and every frame file.
fn copy_set(src: &Path, dst: &Path) -> Result<(), String> {
    let src_profile = src.join(PROFILE_FILE);
    if src_profile.exists() {
        std::fs::copy(&src_profile, dst.join(PROFILE_FILE))
            .map_err(|e| format!("copy profile.json: {e}"))?;
    }
    let src_frames = src.join(FRAMES_DIR);
    let dst_frames = dst.join(FRAMES_DIR);
    if let Ok(entries) = std::fs::read_dir(&src_frames) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let dest = dst_frames.join(entry.file_name());
                std::fs::copy(entry.path(), &dest)
                    .map_err(|e| format!("copy frame {}: {e}", dest.display()))?;
            }
        }
    }
    Ok(())
}

/// Remove a set's entire folder.
pub fn remove_set_dir(root: &Path, id: &str) -> Result<(), String> {
    let dir = set_dir(root, id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{id_ok, seeded_frame_name, FRAME_KEYS};

    #[test]
    fn seeded_frame_name_matches_frontend_contract() {
        // Mirror of src/lib/types.test.ts: frameStorageKey(main, default, fk) + ".png".
        assert_eq!(seeded_frame_name("idle"), "main.default.idle.png");
        assert_eq!(seeded_frame_name("talking-timed"), "main.default.talking-timed.png");
    }

    #[test]
    fn frame_keys_are_the_four_documented() {
        assert_eq!(FRAME_KEYS, ["idle", "talking", "idle-timed", "talking-timed"]);
    }

    #[test]
    fn id_ok_rejects_traversal_and_separators() {
        assert!(id_ok("cat"));
        assert!(id_ok("set_01-abc"));
        assert!(!id_ok(""));
        assert!(!id_ok(".."));
        assert!(!id_ok("a/b"));
        assert!(!id_ok("a\\b"));
        assert!(!id_ok("C:x"));
        assert!(!id_ok(&"x".repeat(65)));
    }
}
