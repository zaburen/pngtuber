// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/** Thin wrappers over the Tauri commands in src-tauri/src/lib.rs. */
import { invoke } from '@tauri-apps/api/core';
import { FRAME_KEYS, OVERLAY_ORIGIN, type FrameKey, type Profile } from './types';

export const loadProfile = () => invoke<Profile | null>('load_profile');
export const saveProfile = (profile: Profile) => invoke<void>('save_profile', { profile });
export const importFrame = (key: FrameKey, src: string) => invoke<string[]>('import_frame', { key, src });
export const clearFrame = (key: FrameKey) => invoke<string[]>('clear_frame', { key });
export const listFrames = () => invoke<string[]>('list_frames');
export const publishState = (json: string) => invoke<void>('publish_state', { json });
export const overlayUrl = () => invoke<string>('overlay_url');
export const profilePath = () => invoke<string>('profile_path');

/**
 * Frame URLs served by the Rust server. `version` busts the browser cache
 * after a re-import.
 */
export function frameUrls(present: string[], version: number): Record<FrameKey, string | null> {
  const out = {} as Record<FrameKey, string | null>;
  for (const k of FRAME_KEYS) {
    out[k] = present.includes(k) ? `${OVERLAY_ORIGIN}/frames/${k}.png?v=${version}` : null;
  }
  return out;
}
