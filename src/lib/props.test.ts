// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { mainLayer } from './poses';
import {
  addProp,
  clearPropTrigger,
  ensurePropBinding,
  listProps,
  removeProp,
  renameProp,
  setPropBehind,
} from './props';
import { mergeProfile } from './types';

const fresh = () => mergeProfile(null);

describe('props', () => {
  it('a fresh profile has no props', () => {
    expect(listProps(fresh())).toEqual([]);
  });

  it('addProp (front) adds a non-voice layer after the avatar, always-on', () => {
    const p = fresh();
    const prop = addProp(p);
    const idx = p.layers.findIndex((l) => l.id === prop.id);
    const mainIdx = p.layers.indexOf(mainLayer(p));
    expect(idx).toBeGreaterThan(mainIdx); // in front
    const layer = p.layers[idx];
    expect(layer.reactsToVoice).toBe(false);
    expect(layer.visible).toBe(true);
    expect(prop.trigger).toBe('');
    expect(listProps(p)).toHaveLength(1);
  });

  it('addProp (behind) draws before the avatar', () => {
    const p = fresh();
    const prop = addProp(p, true);
    const idx = p.layers.findIndex((l) => l.id === prop.id);
    expect(idx).toBeLessThan(p.layers.indexOf(mainLayer(p)));
    expect(listProps(p)[0].behind).toBe(true);
  });

  it('setPropBehind moves the prop across the avatar', () => {
    const p = fresh();
    const prop = addProp(p); // front
    setPropBehind(p, prop.id, true);
    expect(listProps(p)[0].behind).toBe(true);
    setPropBehind(p, prop.id, false);
    expect(listProps(p)[0].behind).toBe(false);
  });

  it('ensurePropBinding hides the layer and adds a hold show-binding', () => {
    const p = fresh();
    const prop = addProp(p);
    const bindingId = ensurePropBinding(p, prop.id);
    const layer = p.layers.find((l) => l.id === prop.id)!;
    expect(layer.visible).toBe(false);
    const b = p.bindings.find((b) => b.id === bindingId);
    expect(b).toMatchObject({ layerId: prop.id, action: 'show', mode: 'hold' });
    expect(ensurePropBinding(p, prop.id)).toBe(bindingId); // idempotent
  });

  it('clearPropTrigger drops the binding and re-shows the layer', () => {
    const p = fresh();
    const prop = addProp(p);
    ensurePropBinding(p, prop.id);
    clearPropTrigger(p, prop.id);
    const layer = p.layers.find((l) => l.id === prop.id)!;
    expect(layer.visible).toBe(true);
    expect(p.bindings.some((b) => b.layerId === prop.id)).toBe(false);
  });

  it('renameProp and removeProp work', () => {
    const p = fresh();
    const prop = addProp(p);
    renameProp(p, prop.id, 'party hat');
    expect(listProps(p)[0].name).toBe('party hat');
    ensurePropBinding(p, prop.id);
    removeProp(p, prop.id);
    expect(listProps(p)).toEqual([]);
    expect(p.bindings.some((b) => b.layerId === prop.id)).toBe(false);
  });

  it('poses and props coexist without interfering', () => {
    const p = fresh();
    addProp(p, true); // background behind
    addProp(p); // accessory in front
    expect(listProps(p)).toHaveLength(2);
    // the main avatar is still between them
    const ids = p.layers.map((l) => l.id);
    const mainIdx = ids.indexOf(mainLayer(p).id);
    expect(mainIdx).toBeGreaterThan(0);
    expect(mainIdx).toBeLessThan(ids.length - 1);
  });
});
