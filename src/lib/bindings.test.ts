// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { BindingEngine } from './bindings';
import type { Binding } from './types';

const bind = (over: Partial<Binding>): Binding => ({
  id: 'b1',
  trigger: 'key:KeyA',
  layerId: 'hat',
  action: 'variant',
  variantId: 'cap',
  mode: 'hold',
  ...over,
});

describe('BindingEngine.handle', () => {
  it('hold: active while down, inactive on release', () => {
    const e = new BindingEngine();
    const bs = [bind({})];
    expect(e.handle(bs, 'key:KeyA', true)).toBe(true);
    expect(e.isActive('b1')).toBe(true);
    expect(e.handle(bs, 'key:KeyA', false)).toBe(true);
    expect(e.isActive('b1')).toBe(false);
  });

  it('toggle: flips on each press, ignores release', () => {
    const e = new BindingEngine();
    const bs = [bind({ mode: 'toggle' })];
    e.handle(bs, 'key:KeyA', true);
    expect(e.handle(bs, 'key:KeyA', false)).toBe(false);
    expect(e.isActive('b1')).toBe(true);
    e.handle(bs, 'key:KeyA', true);
    expect(e.isActive('b1')).toBe(false);
  });

  it('unmatched triggers change nothing', () => {
    const e = new BindingEngine();
    expect(e.handle([bind({})], 'key:KeyB', true)).toBe(false);
  });

  it('one trigger can drive several bindings', () => {
    const e = new BindingEngine();
    const bs = [bind({}), bind({ id: 'b2', layerId: 'main' })];
    e.handle(bs, 'key:KeyA', true);
    expect(e.isActive('b1')).toBe(true);
    expect(e.isActive('b2')).toBe(true);
  });
});

describe('BindingEngine.overrides', () => {
  it('variant action overrides the variant and implies visible', () => {
    const e = new BindingEngine();
    const bs = [bind({})];
    e.handle(bs, 'key:KeyA', true);
    expect(e.overrides(bs).get('hat')).toEqual({ variantId: 'cap', visible: true });
  });

  it('show/hide actions override visibility only', () => {
    const e = new BindingEngine();
    const bs = [bind({ action: 'hide' })];
    e.handle(bs, 'key:KeyA', true);
    expect(e.overrides(bs).get('hat')).toEqual({ visible: false });
  });

  it('later binding on the same layer wins', () => {
    const e = new BindingEngine();
    const bs = [bind({}), bind({ id: 'b2', trigger: 'key:KeyB', variantId: 'shades' })];
    e.handle(bs, 'key:KeyA', true);
    e.handle(bs, 'key:KeyB', true);
    expect(e.overrides(bs).get('hat')?.variantId).toBe('shades');
  });

  it('inactive bindings contribute nothing', () => {
    const e = new BindingEngine();
    expect(e.overrides([bind({})]).size).toBe(0);
  });
});

describe('BindingEngine.prune', () => {
  it('drops active state for removed bindings', () => {
    const e = new BindingEngine();
    e.handle([bind({ mode: 'toggle' })], 'key:KeyA', true);
    expect(e.prune([])).toBe(true);
    expect(e.isActive('b1')).toBe(false);
    expect(e.prune([])).toBe(false);
  });
});
