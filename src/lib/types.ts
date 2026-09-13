// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

export const FRAME_KEYS = ['idle', 'talking', 'idle-blink', 'talking-blink'] as const;
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
    /** Average seconds between blinks (actual interval jitters around this). */
    blinkEvery: number;
  };
  /** The avatar stack. Always at least one layer. */
  layers: Layer[];
  bindings: Binding[];
}

/** Id of the layer old (pre-layer) profiles and fresh installs start with. */
export const BASE_LAYER_ID = 'main';

export function newLayerId(): string {
  return 'l' + Math.random().toString(36).slice(2, 8);
}

function defaultVariants(): Variant[] {
  return [{ id: DEFAULT_VARIANT_ID, name: 'default' }];
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  mic: { deviceId: '', enabled: true, threshold: 0.12, gain: 2.0, hold: 180 },
  look: { scale: 4, pixelated: true, bounce: true, blink: true, blinkEvery: 4.5 },
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
    mic: { ...DEFAULT_PROFILE.mic, ...(s.mic ?? {}) },
    look: { ...DEFAULT_PROFILE.look, ...(s.look ?? {}) },
    layers,
    bindings,
  };
}

/** Storage key for a variant's frame image (matches `<key>.png` on disk). */
export function frameStorageKey(layerId: string, variantId: string, frame: FrameKey): string {
  return `${layerId}.${variantId}.${frame}`;
}

export function newVariantId(): string {
  return 'v' + Math.random().toString(36).slice(2, 8);
}
