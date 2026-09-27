// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

export const FRAME_KEYS = ['idle', 'talking', 'idle-timed', 'talking-timed'] as const;
export type FrameKey = (typeof FRAME_KEYS)[number];

/**
 * Overlay server port. Must match `DEFAULT_PORT` in src-tauri/src/server.rs
 * (two sources of truth for a fixed port). If the port ever becomes dynamic,
 * the frontend must read it from Rust (backend.overlayUrl) instead of these.
 */
export const OVERLAY_PORT = 8737;
export const OVERLAY_ORIGIN = `http://127.0.0.1:${OVERLAY_PORT}`;

/**
 * One element of the avatar stack, drawn bottom (index 0) to top.
 * A layer that doesn't react to voice uses only its `idle` image.
 * Each layer holds one or more variants (alternative looks: hairstyles,
 * held items, button poses); exactly one is active. Frame files are stored
 * as `<layerId>.<variantId>.<frameKey>.png` in the profile.
 */
export interface Layer {
  id: string;
  name: string;
  reactsToVoice: boolean;
  visible: boolean;
  variants: Variant[];
  /** id of the variant currently shown (and edited). */
  activeVariant: string;
  /** Bounce along with the character on talk (accessories that ride the face).
   * Ignored for the voice-reactive main layer (which always bounces). Always
   * populated after mergeProfile — see newLayer(). */
  followBounce: boolean;
  /** Pixel nudge from center so an accessory lines up. Always populated. */
  offset: { x: number; y: number };
  /** Per-layer size multiplier of the global scale (1 = same size as the
   * character grid). Always populated. */
  scale: number;
}

export interface Variant {
  id: string;
  name: string;
}

/** What a binding does to its layer while active. */
export type BindingAction = 'variant' | 'show' | 'hide';

/**
 * A global-input binding: while its trigger is active, override one layer.
 * Triggers are `key:<name>` (rdev Key debug name, e.g. `key:KeyA`) or
 * `pad:<name>` (gilrs Button, e.g. `pad:South`); empty until captured.
 * Bindings never touch the saved layer config — they are runtime overrides.
 */
export interface Binding {
  id: string;
  trigger: string;
  layerId: string;
  action: BindingAction;
  /** Variant shown while active (action 'variant' only; implies visible). */
  variantId: string;
  /** 'hold' = active while the trigger is down; 'toggle' = flips per press. */
  mode: 'hold' | 'toggle';
}

export function newBindingId(): string {
  return 'b' + Math.random().toString(36).slice(2, 8);
}

/** Id of the variant every layer starts with. */
export const DEFAULT_VARIANT_ID = 'default';

/** Mic tuning — shared across all sets (it's about your hardware, not the avatar). */
export interface MicSettings {
  deviceId: string;
  enabled: boolean;
  threshold: number;
  gain: number;
  /** ms to keep "talking" after the level drops below threshold */
  hold: number;
}

/** Settings shared across every set, stored in global.json. */
export interface GlobalSettings {
  mic: MicSettings;
}

/** One avatar set in the registry (a self-contained avatar). */
export interface SetEntry {
  id: string;
  name: string;
}

/** The set registry from the backend. */
export interface SetsIndex {
  active: string;
  sets: SetEntry[];
}

export interface Profile {
  version: 1;
  look: {
    scale: number;
    pixelated: boolean;
    bounce: boolean;
    /** Bounce height multiplier when `bounce` is on (1 = default). */
    bounceScale: number;
    /** Play the periodic "timed" frame variant (blink/twitch/sway). */
    timed: boolean;
    /** Average seconds between timed frames (actual interval jitters around this). */
    timedEvery: number;
    /**
     * Optional output crop. When `enabled`, the OBS overlay renders ONLY what
     * falls inside a `w`×`h` box centered on the avatar origin (hard crop), so
     * the browser-source size is the frame size. The in-app preview always
     * shows everything, drawing the frame as a guide. Off = uncropped (legacy).
     */
    frame: { enabled: boolean; w: number; h: number };
  };
  /** The avatar stack. Always at least one layer. */
  layers: Layer[];
  bindings: Binding[];
  /** Frame storage key -> original file path, so a frame can be re-imported. */
  frameSources: Record<string, string>;
}

/** Id of the layer old (pre-layer) profiles and fresh installs start with. */
export const BASE_LAYER_ID = 'main';

export function newLayerId(): string {
  return 'l' + Math.random().toString(36).slice(2, 8);
}

/**
 * The character layer: the main voice-reactive avatar layer that the Character
 * UI, props, and (2.0) poses hang off. Falls back to the first layer if no
 * layer carries the canonical id.
 */
export function mainLayer(profile: Profile): Layer {
  return profile.layers.find((l) => l.id === BASE_LAYER_ID) ?? profile.layers[0];
}

export function defaultVariants(): Variant[] {
  return [{ id: DEFAULT_VARIANT_ID, name: 'default' }];
}

/**
 * Build a fully-populated layer from partial input — the single source of truth
 * for layer defaults. Both creation (addProp) and migration (mergeProfile) go
 * through here, so a default value lives in exactly one place. Because Layer's
 * fields are required, the compiler forces a default here for every field
 * (including any added later), and downstream code never re-defaults.
 */
export function newLayer(partial: Partial<Layer> & Pick<Layer, 'id'>): Layer {
  const variants =
    partial.variants && partial.variants.length > 0 ? partial.variants : defaultVariants();
  return {
    id: partial.id,
    name: partial.name ?? 'layer',
    reactsToVoice: partial.reactsToVoice ?? false,
    visible: partial.visible ?? true,
    variants,
    activeVariant: variants.some((v) => v.id === partial.activeVariant)
      ? partial.activeVariant!
      : variants[0].id,
    followBounce: partial.followBounce ?? true,
    offset: { x: partial.offset?.x ?? 0, y: partial.offset?.y ?? 0 },
    scale: partial.scale ?? 1,
  };
}

export const DEFAULT_MIC: MicSettings = {
  deviceId: '',
  enabled: true,
  threshold: 0.12,
  gain: 2.0,
  hold: 180,
};

export const DEFAULT_GLOBAL: GlobalSettings = { mic: { ...DEFAULT_MIC } };

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  look: {
    scale: 4,
    pixelated: true,
    bounce: true,
    bounceScale: 1,
    timed: true,
    timedEvery: 4.5,
    frame: { enabled: false, w: 300, h: 400 },
  },
  layers: [newLayer({ id: BASE_LAYER_ID, name: 'avatar', reactsToVoice: true })],
  bindings: [],
  frameSources: {},
};

/** One resolved layer for drawing: which image (if any) it shows right now. */
export interface RenderLayer {
  id: string;
  url: string | null;
  /** Pixel nudge from center (source pixels, scaled at draw time). */
  offsetX: number;
  offsetY: number;
  /** Bounce with the character on talk (the main layer and following props). */
  follow: boolean;
  /** Per-layer size multiplier of the global scale (1 = same). */
  scale: number;
  /** True for the voice-reactive character layer; the preview fit-to-view anchor. */
  main: boolean;
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
  /** Bounce height multiplier (1 = default). */
  bounceScale: number;
  /** Output crop. Overlay clips to `w`×`h` when enabled; preview draws a guide. */
  frame: { enabled: boolean; w: number; h: number };
}

/** Merge a stored profile over the defaults so fields added later get values. */
export function mergeProfile(stored: unknown): Profile {
  const s = (stored ?? {}) as Partial<Profile>;
  const layers: Layer[] =
    Array.isArray(s.layers) && s.layers.length > 0
      ? // newLayer() fills every default and validates activeVariant against the variants
        s.layers.map((l, i) => newLayer({ ...l, id: l.id ?? newLayerId(), name: l.name ?? `layer ${i + 1}` }))
      : // pre-layer profiles (M1) had a single implicit avatar
        DEFAULT_PROFILE.layers.map((l) => ({ ...l, variants: l.variants.map((v) => ({ ...v })) }));
  const layerIds = new Set(layers.map((l) => l.id));
  const bindings: Binding[] = (Array.isArray(s.bindings) ? s.bindings : [])
    .filter((b) => b && layerIds.has(b.layerId))
    .map((b) => ({
      id: b.id ?? newBindingId(),
      trigger: b.trigger ?? '',
      layerId: b.layerId,
      action: b.action === 'show' || b.action === 'hide' ? b.action : 'variant',
      variantId: b.variantId ?? '',
      mode: b.mode === 'toggle' ? 'toggle' : 'hold',
    }));
  return {
    version: 1,
    // `frame` is nested, so deep-merge it: a profile saved before frame-export
    // has no look.frame, and one saved mid-migration could carry a partial one.
    look: {
      ...DEFAULT_PROFILE.look,
      ...(s.look ?? {}),
      frame: { ...DEFAULT_PROFILE.look.frame, ...(s.look?.frame ?? {}) },
    },
    layers,
    bindings,
    frameSources:
      s.frameSources && typeof s.frameSources === 'object' ? { ...s.frameSources } : {},
  };
}

/**
 * Merge stored global settings over defaults. `legacyMic` seeds the mic from an
 * old profile that still carried a `mic` block, a one-time migration to global.
 */
export function mergeGlobal(stored: unknown, legacyMic?: unknown): GlobalSettings {
  const s = (stored ?? {}) as Partial<GlobalSettings>;
  const legacy = (legacyMic ?? {}) as Partial<MicSettings>;
  return {
    mic: { ...DEFAULT_MIC, ...legacy, ...(s.mic ?? {}) },
  };
}

/** Storage key for a variant's frame image (matches `<key>.png` on disk). */
export function frameStorageKey(layerId: string, variantId: string, frame: FrameKey): string {
  return `${layerId}.${variantId}.${frame}`;
}

export function newVariantId(): string {
  return 'v' + Math.random().toString(36).slice(2, 8);
}
