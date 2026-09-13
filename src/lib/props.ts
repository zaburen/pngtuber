// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * "Props" are the user-facing concept for elements that do NOT inherit the
 * voice states — backgrounds and overlay accessories (see docs/ux-spec.md).
 * They coexist with the avatar and with each other (a hat and glasses at once),
 * are placed behind or in front of it, and are either always shown or shown
 * while a trigger is held.
 *
 * Under the hood a prop is a non-voice layer (`reactsToVoice: false`) drawn in
 * the layer stack. "Always shown" = the layer is visible with no binding;
 * "show while held" = the layer is hidden by default plus a hold show-binding.
 * This module is the single tested translation the UI and tests share.
 */
import { mainLayer } from './poses';
import {
  DEFAULT_VARIANT_ID,
  newBindingId,
  newLayerId,
  type Binding,
  type Layer,
  type Profile,
} from './types';

export interface Prop {
  /** The layer id backing this prop. */
  id: string;
  name: string;
  /** Drawn behind the avatar (a background) rather than in front. */
  behind: boolean;
  /** Trigger from the prop's show-binding; '' means always shown. */
  trigger: string;
  bindingId: string | null;
}

function propBinding(profile: Profile, layerId: string): Binding | undefined {
  return profile.bindings.find(
    (b) => b.layerId === layerId && (b.action === 'show' || b.action === 'hide'),
  );
}

/** Props are every non-main, non-voice layer. */
export function listProps(profile: Profile): Prop[] {
  const main = mainLayer(profile);
  const mainIndex = profile.layers.indexOf(main);
  return profile.layers
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.id !== main.id && !l.reactsToVoice)
    .map(({ l, i }) => {
      const b = propBinding(profile, l.id);
      return { id: l.id, name: l.name, behind: i < mainIndex, trigger: b?.trigger ?? '', bindingId: b?.id ?? null };
    });
}

/** Place `layer` behind the avatar (before main) or in front (top of stack). */
function place(profile: Profile, layer: Layer, behind: boolean): void {
  profile.layers = profile.layers.filter((l) => l.id !== layer.id);
  if (behind) profile.layers.splice(profile.layers.indexOf(mainLayer(profile)), 0, layer);
  else profile.layers.push(layer);
}

export function addProp(profile: Profile, behind = false): Prop {
  const layer: Layer = {
    id: newLayerId(),
    name: behind ? 'background' : 'prop',
    reactsToVoice: false,
    visible: true, // always-on by default; a trigger hides-then-shows it
    variants: [{ id: DEFAULT_VARIANT_ID, name: 'default' }],
    activeVariant: DEFAULT_VARIANT_ID,
  };
  place(profile, layer, behind);
  return { id: layer.id, name: layer.name, behind, trigger: '', bindingId: null };
}

/** Remove a prop: its layer and any bindings. Frame files cleared by caller. */
export function removeProp(profile: Profile, layerId: string): void {
  profile.layers = profile.layers.filter((l) => l.id !== layerId);
  profile.bindings = profile.bindings.filter((b) => b.layerId !== layerId);
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
 * Make the prop trigger-controlled: hide it by default and attach a hold
 * show-binding (creating one if needed). Returns the binding id so the caller
 * can arm trigger capture. Idempotent.
 */
export function ensurePropBinding(profile: Profile, layerId: string): string {
  const layer = profile.layers.find((l) => l.id === layerId);
  if (layer) layer.visible = false;
  let b = propBinding(profile, layerId);
  if (!b) {
    b = { id: newBindingId(), trigger: '', layerId, action: 'show', variantId: '', mode: 'hold' };
    profile.bindings.push(b);
  }
  return b.id;
}

/** Revert to always-shown: drop the binding and make the layer visible. */
export function clearPropTrigger(profile: Profile, layerId: string): void {
  const layer = profile.layers.find((l) => l.id === layerId);
  if (layer) layer.visible = true;
  profile.bindings = profile.bindings.filter(
    (b) => !(b.layerId === layerId && (b.action === 'show' || b.action === 'hide')),
  );
}
