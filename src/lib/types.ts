// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

export const FRAME_KEYS = ['idle', 'talking', 'idle-timed', 'talking-timed'] as const;
export type FrameKey = (typeof FRAME_KEYS)[number];

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
  /** Non-voice prop layers: bounce along with the character on talk (accessories
   * that ride the face). Ignored for the voice-reactive main layer (always bounces). */
  followBounce?: boolean;
  /** Non-voice prop layers: pixel nudge from center so an accessory lines up. */
  offset?: { x: number; y: number };
  /** Per-layer size multiplier of the global scale (1 = same size as the character grid). */
  scale?: number;
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

function defaultVariants(): Variant[] {
  return [{ id: DEFAULT_VARIANT_ID, name: 'default' }];
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
  look: { scale: 4, pixelated: true, bounce: true, bounceScale: 1, timed: true, timedEvery: 4.5 },
  layers: [
    {
      id: BASE_LAYER_ID,
      name: 'avatar',
      reactsToVoice: true,
      visible: true,
      variants: defaultVariants(),
      activeVariant: DEFAULT_VARIANT_ID,
    },
  ],
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
}

/** Merge a stored profile over the defaults so fields added later get values. */
export function mergeProfile(stored: unknown): Profile {
  const s = (stored ?? {}) as Partial<Profile>;
  const layers: Layer[] =
    Array.isArray(s.layers) && s.layers.length > 0
      ? s.layers.map((l, i) => {
          const variants =
            Array.isArray(l.variants) && l.variants.length > 0 ? l.variants : defaultVariants();
          return {
            id: l.id ?? newLayerId(),
            name: l.name ?? `layer ${i + 1}`,
            reactsToVoice: l.reactsToVoice ?? false,
            visible: l.visible ?? true,
            variants,
            activeVariant: variants.some((v) => v.id === l.activeVariant)
              ? l.activeVariant!
              : variants[0].id,
            followBounce: l.followBounce ?? true,
            offset: { x: l.offset?.x ?? 0, y: l.offset?.y ?? 0 },
            scale: l.scale ?? 1,
          };
        })
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
    look: { ...DEFAULT_PROFILE.look, ...(s.look ?? {}) },
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
