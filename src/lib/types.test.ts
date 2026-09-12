// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { BASE_LAYER_ID, DEFAULT_PROFILE, DEFAULT_VARIANT_ID, frameStorageKey, mergeProfile } from './types';

describe('mergeProfile', () => {
  it('gives a fresh install one voice-reactive base layer', () => {
    const p = mergeProfile(null);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].id).toBe(BASE_LAYER_ID);
    expect(p.layers[0].reactsToVoice).toBe(true);
    expect(p.layers[0].activeVariant).toBe(DEFAULT_VARIANT_ID);
  });

  it('migrates an M1 profile (no layers field) onto the base layer', () => {
    const p = mergeProfile({ version: 1, mic: { threshold: 0.3 } });
    expect(p.mic.threshold).toBe(0.3);
    expect(p.mic.gain).toBe(DEFAULT_PROFILE.mic.gain); // filled from defaults
    expect(p.layers[0].id).toBe(BASE_LAYER_ID);
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
});

describe('frameStorageKey', () => {
  it('joins layer, variant and frame with dots', () => {
    expect(frameStorageKey('main', 'default', 'idle-blink')).toBe('main.default.idle-blink');
  });
});
