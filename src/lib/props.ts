// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * "Layers" (called props in the code for the non-character layers) are the
 * v1 way to add backgrounds and overlay accessories (see docs/ux-spec.md).
 * They coexist with the character and each other, sit behind or in front of it,
 * can move with it on talk, and nudge into position. On/off is just the layer's
 * `visible` flag (no triggers in v1 — the input engine is shelved for 2.0).
 *
 * Under the hood a layer is a non-voice layer (`reactsToVoice: false`) with one
 * image. This module is the single tested translation the UI and tests share.
 */
import { mainLayer, newLayer, newLayerId, type Layer, type Profile } from './types';

export interface Prop {
  /** The layer id backing this prop. */
  id: string;
  name: string;
  /** Drawn behind the character (a background) rather than in front. */
  behind: boolean;
}

/** Props are every non-main, non-voice layer. */
export function listProps(profile: Profile): Prop[] {
  const main = mainLayer(profile);
  const mainIndex = profile.layers.indexOf(main);
  return profile.layers
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.id !== main.id && !l.reactsToVoice)
    .map(({ l, i }) => ({ id: l.id, name: l.name, behind: i < mainIndex }));
}

/** Place `layer` behind the character (before main) or in front (top of stack). */
function place(profile: Profile, layer: Layer, behind: boolean): void {
  profile.layers = profile.layers.filter((l) => l.id !== layer.id);
  if (behind) profile.layers.splice(profile.layers.indexOf(mainLayer(profile)), 0, layer);
  else profile.layers.push(layer);
}

export function addProp(profile: Profile, behind = false): Prop {
  const layer = newLayer({
    id: newLayerId(),
    name: behind ? 'background' : 'accessory',
    reactsToVoice: false,
    followBounce: !behind, // accessories ride the face; backgrounds stay put
  });
  place(profile, layer, behind);
  return { id: layer.id, name: layer.name, behind };
}

/** Remove a layer. Frame files cleared by caller. */
export function removeProp(profile: Profile, layerId: string): void {
  profile.layers = profile.layers.filter((l) => l.id !== layerId);
}

export function renameProp(profile: Profile, layerId: string, name: string): void {
  const l = profile.layers.find((x) => x.id === layerId);
  if (l) l.name = name;
}

export function setPropBehind(profile: Profile, layerId: string, behind: boolean): void {
  const layer = profile.layers.find((l) => l.id === layerId);
  if (layer) place(profile, layer, behind);
}

/**
 * Reorder a layer among its neighbours on the same side of the character.
 * Arrows never cross the character (use the behind/front toggle for that).
 */
export function moveProp(profile: Profile, layerId: string, dir: -1 | 1): void {
  const i = profile.layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= profile.layers.length) return;
  if (profile.layers[j].id === mainLayer(profile).id) return; // don't cross the character
  [profile.layers[i], profile.layers[j]] = [profile.layers[j], profile.layers[i]];
}
