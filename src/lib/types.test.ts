// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import {
  BASE_LAYER_ID,
  DEFAULT_MIC,
  DEFAULT_PROFILE,
  DEFAULT_VARIANT_ID,
  FRAME_KEYS,
  frameStorageKey,
  mergeGlobal,
  mergeProfile,
  newLayer,
} from './types';

describe('newLayer (single source of layer defaults)', () => {
  it('fills every field with its default from a minimal input', () => {
    const l = newLayer({ id: 'x' });
    expect(l).toEqual({
      id: 'x',
      name: 'layer',
      reactsToVoice: false,
      visible: true,
      variants: [{ id: DEFAULT_VARIANT_ID, name: 'default' }],
      activeVariant: DEFAULT_VARIANT_ID,
      followBounce: true,
      offset: { x: 0, y: 0 },
      scale: 1,
    });
  });

  it('keeps provided values and validates activeVariant against the variants', () => {
    const l = newLayer({
      id: 'x',
      scale: 2,
      offset: { x: 5, y: -3 },
      followBounce: false,
      variants: [{ id: 'a', name: 'a' }],
      activeVariant: 'gone', // not in variants -> falls back to first
    });
    expect(l.scale).toBe(2);
    expect(l.offset).toEqual({ x: 5, y: -3 });
    expect(l.followBounce).toBe(false);
    expect(l.activeVariant).toBe('a');
  });
});

describe('mergeProfile', () => {
  it('gives a fresh install one voice-reactive base layer', () => {
    const p = mergeProfile(null);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].id).toBe(BASE_LAYER_ID);
    expect(p.layers[0].reactsToVoice).toBe(true);
    expect(p.layers[0].activeVariant).toBe(DEFAULT_VARIANT_ID);
  });

  it('migrates an M1 profile (no layers field) onto the base layer', () => {
    const p = mergeProfile({ version: 1 });
    expect(p.layers[0].id).toBe(BASE_LAYER_ID);
  });

  it('defaults frameSources to an empty map', () => {
    expect(mergeProfile(null).frameSources).toEqual({});
    expect(mergeProfile({ frameSources: { 'main.default.idle': 'C:/a.png' } }).frameSources).toEqual({
      'main.default.idle': 'C:/a.png',
    });
  });

  it('does not share variant objects with DEFAULT_PROFILE', () => {
    const p = mergeProfile(null);
    p.layers[0].variants.push({ id: 'x', name: 'x' });
    expect(DEFAULT_PROFILE.layers[0].variants).toHaveLength(1);
  });

  it('adds a default variant to layers saved before variants existed', () => {
    const p = mergeProfile({ layers: [{ id: 'main', name: 'avatar', reactsToVoice: true, visible: true }] });
    expect(p.layers[0].variants).toEqual([{ id: DEFAULT_VARIANT_ID, name: 'default' }]);
    expect(p.layers[0].activeVariant).toBe(DEFAULT_VARIANT_ID);
  });

  it('resets activeVariant when it points at a deleted variant', () => {
    const p = mergeProfile({
      layers: [{ id: 'a', name: 'a', reactsToVoice: false, visible: true, variants: [{ id: 'v1', name: 'one' }], activeVariant: 'gone' }],
    });
    expect(p.layers[0].activeVariant).toBe('v1');
  });

  it('gives pre-binding profiles an empty bindings list', () => {
    expect(mergeProfile({ version: 1 }).bindings).toEqual([]);
  });

  it('fills binding defaults and drops bindings whose layer is gone', () => {
    const p = mergeProfile({
      layers: [{ id: 'main', name: 'avatar', reactsToVoice: true, visible: true }],
      bindings: [
        { layerId: 'main', trigger: 'key:KeyA' },
        { layerId: 'deleted', trigger: 'key:KeyB', action: 'show' },
      ],
    });
    expect(p.bindings).toHaveLength(1);
    expect(p.bindings[0]).toMatchObject({
      layerId: 'main',
      trigger: 'key:KeyA',
      action: 'variant',
      mode: 'hold',
    });
    expect(p.bindings[0].id).toBeTruthy();
  });
});

describe('look.frame (output crop) migration', () => {
  it('defaults to a disabled 300x400 frame on a fresh install', () => {
    expect(mergeProfile(null).look.frame).toEqual({ enabled: false, w: 300, h: 400 });
  });

  it('adds the default frame to a profile saved before frame-export existed', () => {
    const p = mergeProfile({ look: { scale: 6, pixelated: false } });
    expect(p.look.scale).toBe(6); // other look fields kept
    expect(p.look.frame).toEqual({ enabled: false, w: 300, h: 400 });
  });

  it('deep-merges a partial stored frame over the defaults', () => {
    const p = mergeProfile({ look: { frame: { enabled: true } } });
    expect(p.look.frame).toEqual({ enabled: true, w: 300, h: 400 });
  });

  it('keeps a fully stored frame', () => {
    const p = mergeProfile({ look: { frame: { enabled: true, w: 512, h: 512 } } });
    expect(p.look.frame).toEqual({ enabled: true, w: 512, h: 512 });
  });
});

describe('frameStorageKey', () => {
  it('joins layer, variant and frame with dots', () => {
    expect(frameStorageKey('main', 'default', 'idle-timed')).toBe('main.default.idle-timed');
  });
});

// The Rust host (src-tauri/src/sets.rs) seeds bundled character art on disk as
// `main.default.<frameKey>.png`, hardcoded. The frontend resolves those frames
// via frameStorageKey(mainLayer.id, DEFAULT_VARIANT_ID, fk). They only agree
// while the constants below hold; sets.rs has the mirror test (seeded_frame_name).
describe('frame storage key contract (shared with Rust seeding)', () => {
  it('keys character frames as main.default.<frameKey>', () => {
    for (const fk of FRAME_KEYS) {
      expect(frameStorageKey(BASE_LAYER_ID, DEFAULT_VARIANT_ID, fk)).toBe(`main.default.${fk}`);
    }
  });

  it('BASE_LAYER_ID and DEFAULT_VARIANT_ID are the canonical values', () => {
    expect(BASE_LAYER_ID).toBe('main');
    expect(DEFAULT_VARIANT_ID).toBe('default');
  });
});

describe('mergeGlobal', () => {
  it('fills mic defaults on a fresh install', () => {
    expect(mergeGlobal(null).mic.gain).toBe(DEFAULT_MIC.gain);
  });

  it('seeds mic from a legacy profile mic block (migration)', () => {
    const g = mergeGlobal(null, { threshold: 0.3 });
    expect(g.mic.threshold).toBe(0.3);
    expect(g.mic.gain).toBe(DEFAULT_MIC.gain); // other fields still defaulted
  });

  it('prefers stored global mic over the legacy block', () => {
    const g = mergeGlobal({ mic: { threshold: 0.5 } }, { threshold: 0.3 });
    expect(g.mic.threshold).toBe(0.5);
  });
});
