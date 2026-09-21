// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { mainLayer } from './poses';
import { addProp, listProps, moveProp, removeProp, renameProp, setPropBehind } from './props';
import { mergeProfile } from './types';

const fresh = () => mergeProfile(null);

describe('props / layers', () => {
  it('a fresh profile has no layers', () => {
    expect(listProps(fresh())).toEqual([]);
  });

  it('addProp (front) adds a non-voice layer after the character, visible, following', () => {
    const p = fresh();
    const prop = addProp(p);
    const idx = p.layers.findIndex((l) => l.id === prop.id);
    expect(idx).toBeGreaterThan(p.layers.indexOf(mainLayer(p))); // in front
    const layer = p.layers[idx];
    expect(layer.reactsToVoice).toBe(false);
    expect(layer.visible).toBe(true);
    expect(layer.followBounce).toBe(true);
    expect(layer.offset).toEqual({ x: 0, y: 0 });
  });

  it('addProp (behind) draws before the character and does not follow the bounce', () => {
    const p = fresh();
    const prop = addProp(p, true);
    expect(p.layers.findIndex((l) => l.id === prop.id)).toBeLessThan(p.layers.indexOf(mainLayer(p)));
    expect(listProps(p)[0].behind).toBe(true);
    expect(p.layers.find((l) => l.id === prop.id)!.followBounce).toBe(false);
  });

  it('setPropBehind moves the layer across the character', () => {
    const p = fresh();
    const prop = addProp(p);
    setPropBehind(p, prop.id, true);
    expect(listProps(p)[0].behind).toBe(true);
    setPropBehind(p, prop.id, false);
    expect(listProps(p)[0].behind).toBe(false);
  });

  it('moveProp reorders same-side layers but never crosses the character', () => {
    const p = fresh();
    const a = addProp(p); // front
    const b = addProp(p); // front, above a
    // order in stack: main, a, b
    moveProp(p, b.id, -1); // b down -> main, b, a
    expect(p.layers.map((l) => l.id).slice(1)).toEqual([b.id, a.id]);
    // a is now top; moving it up past nothing is a no-op
    moveProp(p, b.id, -1); // would cross main -> no-op
    expect(p.layers.map((l) => l.id).slice(1)).toEqual([b.id, a.id]);
  });

  it('renameProp and removeProp work', () => {
    const p = fresh();
    const prop = addProp(p);
    renameProp(p, prop.id, 'party hat');
    expect(listProps(p)[0].name).toBe('party hat');
    removeProp(p, prop.id);
    expect(listProps(p)).toEqual([]);
  });

  it('the character stays between a background and a front accessory', () => {
    const p = fresh();
    addProp(p, true);
    addProp(p);
    const ids = p.layers.map((l) => l.id);
    const mainIdx = ids.indexOf(mainLayer(p).id);
    expect(mainIdx).toBeGreaterThan(0);
    expect(mainIdx).toBeLessThan(ids.length - 1);
  });
});
