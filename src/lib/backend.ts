// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/** Thin wrappers over the Tauri commands in src-tauri/src/lib.rs. */
import { invoke } from '@tauri-apps/api/core';
import { OVERLAY_ORIGIN, type GlobalSettings, type Profile, type SetsIndex } from './types';

export const loadProfile = () => invoke<Profile | null>('load_profile');
export const saveProfile = (profile: Profile) => invoke<void>('save_profile', { profile });

// --- Sets (each set is a self-contained avatar) ---
export const listSets = () => invoke<SetsIndex>('list_sets');
export const defaultAvatars = () => invoke<string[]>('default_avatars');
/** Overwrite the active set's character frames with a bundled avatar's. Returns present keys. */
export const applyDefault = (name: string) => invoke<string[]>('apply_default', { name });
/** `from` is `blank`, `default:<name>`, or `copy:<setId>`. Returns the new id. */
export const createSet = (name: string, from: string) => invoke<string>('create_set', { name, from });
export const switchSet = (id: string) => invoke<void>('switch_set', { id });
export const renameSet = (id: string, name: string) => invoke<void>('rename_set', { id, name });
/** Returns the id active after deletion. */
export const deleteSet = (id: string) => invoke<string>('delete_set', { id });

// --- Global settings (mic; shared across sets) ---
export const loadGlobal = () => invoke<unknown>('load_global');
export const saveGlobal = (value: GlobalSettings) => invoke<void>('save_global', { value });
/** `key` is a frame storage key: `<layerId>.<variantId>.<frameKey>`. Returns all present keys. */
export const importFrame = (key: string, src: string) => invoke<string[]>('import_frame', { key, src });
export const clearFrame = (key: string) => invoke<string[]>('clear_frame', { key });
export const listFrames = () => invoke<string[]>('list_frames');
export const publishState = (json: string) => invoke<void>('publish_state', { json });
export const overlayUrl = () => invoke<string>('overlay_url');
export const profilePath = () => invoke<string>('profile_path');
// Global-input IPC — shelved for v1 (no input hook is spawned; see lib.rs setup).
// Kept wired for 2.0 hotkey/gamepad layer triggers.
/** Register which triggers the global input hook may forward (all else is dropped). */
export const setBoundTriggers = (triggers: string[]) => invoke<void>('set_bound_triggers', { triggers });
/** Binding editor: forward the next key/button press once as `input-capture`. */
export const setTriggerCapture = (on: boolean) => invoke<void>('set_trigger_capture', { on });

/**
 * Frame URLs served by the Rust server, keyed by frame storage key.
 * `version` busts the browser cache after a re-import.
 */
export function frameUrls(present: string[], version: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of present) out[key] = `${OVERLAY_ORIGIN}/frames/${key}.png?v=${version}`;
  return out;
}
