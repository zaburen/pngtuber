// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

export const FRAME_KEYS = ['idle', 'talking', 'idle-blink', 'talking-blink'] as const;
export type FrameKey = (typeof FRAME_KEYS)[number];

export const OVERLAY_PORT = 8737;
export const OVERLAY_ORIGIN = `http://127.0.0.1:${OVERLAY_PORT}`;

/**
 * One element of the avatar stack, drawn bottom (index 0) to top.
 * A layer that doesn't react to voice uses only its `idle` image.
 * Frame files are stored as `<layerId>.<frameKey>.png` in the profile.
 */
export interface Layer {
  id: string;
  name: string;
  reactsToVoice: boolean;
  visible: boolean;
}

export interface Profile {
  version: 1;
  mic: {
    deviceId: string;
    enabled: boolean;
    threshold: number;
    gain: number;
    /** ms to keep "talking" after the level drops below threshold */
    hold: number;
  };
  look: {
    scale: number;
    pixelated: boolean;
    bounce: boolean;
    blink: boolean;
  };
  /** The avatar stack. Always at least one layer. */
  layers: Layer[];
}

/** Id of the layer old (pre-layer) profiles and fresh installs start with. */
export const BASE_LAYER_ID = 'main';

export function newLayerId(): string {
  return 'l' + Math.random().toString(36).slice(2, 8);
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  mic: { deviceId: '', enabled: true, threshold: 0.12, gain: 2.0, hold: 180 },
  look: { scale: 4, pixelated: true, bounce: true, blink: true },
  layers: [{ id: BASE_LAYER_ID, name: 'avatar', reactsToVoice: true, visible: true }],
};

/** One resolved layer for drawing: which image (if any) it shows right now. */
export interface RenderLayer {
  id: string;
  url: string | null;
}

/** Everything an overlay needs to draw one frame. Sent over the WebSocket. */
export interface RenderState {
  /** Bottom → top. Layers with url null are skipped. */
  layers: RenderLayer[];
  /**
   * True when no layer has any user image — receiver draws the built-in
   * placeholder for `placeholderFrame` instead.
   */
  placeholder: boolean;
  placeholderFrame: FrameKey;
  scale: number;
  pixelated: boolean;
  /** Increments every time a bounce should play. */
  bounceSeq: number;
}

/** Merge a stored profile over the defaults so fields added later get values. */
export function mergeProfile(stored: unknown): Profile {
  const s = (stored ?? {}) as Partial<Profile>;
  const layers: Layer[] =
    Array.isArray(s.layers) && s.layers.length > 0
      ? s.layers.map((l, i) => ({
          id: l.id ?? newLayerId(),
          name: l.name ?? `layer ${i + 1}`,
          reactsToVoice: l.reactsToVoice ?? false,
          visible: l.visible ?? true,
        }))
      : // pre-layer profiles (M1) had a single implicit avatar
        DEFAULT_PROFILE.layers.map((l) => ({ ...l }));
  return {
    version: 1,
    mic: { ...DEFAULT_PROFILE.mic, ...(s.mic ?? {}) },
    look: { ...DEFAULT_PROFILE.look, ...(s.look ?? {}) },
    layers,
  };
}

/** Storage key for a layer's frame image (matches `<key>.png` on disk). */
export function frameStorageKey(layerId: string, frame: FrameKey): string {
  return `${layerId}.${frame}`;
}
