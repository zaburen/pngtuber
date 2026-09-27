// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * "Poses" are the user-facing concept for alternate full looks of the avatar
 * (see docs/ux-spec.md). Each pose inherits the core states (idle/talking) and
 * is shown while its trigger is active.
 *
 * Under the hood a pose is a variant of the main voice-reactive layer plus a
 * hold-binding pointing at it; the base look is the `default` variant. This
 * module is the single tested translation between pose operations and those
 * layer/variant/binding mutations, so the UI and the tests share one path.
 */
import {
  DEFAULT_VARIANT_ID,
  mainLayer,
  newBindingId,
  newVariantId,
  type Binding,
  type Profile,
} from './types';

export interface Pose {
  /** The variant id backing this pose. */
  id: string;
  name: string;
  /** Trigger from the pose's binding; '' until captured. */
  trigger: string;
  /** The binding id driving this pose, if one exists. */
  bindingId: string | null;
}

function poseBinding(profile: Profile, variantId: string): Binding | undefined {
  const main = mainLayer(profile);
  return profile.bindings.find(
    (b) => b.layerId === main.id && b.action === 'variant' && b.variantId === variantId,
  );
}

/** Poses are every non-default variant of the main layer. */
export function listPoses(profile: Profile): Pose[] {
  const main = mainLayer(profile);
  if (!main) return [];
  return main.variants
    .filter((v) => v.id !== DEFAULT_VARIANT_ID)
    .map((v) => {
      const b = poseBinding(profile, v.id);
      return { id: v.id, name: v.name, trigger: b?.trigger ?? '', bindingId: b?.id ?? null };
    });
}

/**
 * Add a new pose: a variant on the main layer plus an (unbound) hold binding.
 * The base (default) variant stays active — a pose only shows while triggered.
 */
export function addPose(profile: Profile, name?: string): Pose {
  const main = mainLayer(profile);
  const id = newVariantId();
  main.variants.push({ id, name: name ?? `pose ${main.variants.length}` });
  const binding: Binding = {
    id: newBindingId(),
    trigger: '',
    layerId: main.id,
    action: 'variant',
    variantId: id,
    mode: 'hold',
  };
  profile.bindings.push(binding);
  return { id, name: name ?? `pose ${main.variants.length - 1}`, trigger: '', bindingId: binding.id };
}

/** Remove a pose: its variant and any bindings pointing at it. Frame files are
 * cleared separately by the caller (they need the backend). */
export function removePose(profile: Profile, variantId: string): void {
  const main = mainLayer(profile);
  main.variants = main.variants.filter((v) => v.id !== variantId);
  profile.bindings = profile.bindings.filter(
    (b) => !(b.layerId === main.id && b.variantId === variantId),
  );
  if (main.activeVariant === variantId) main.activeVariant = DEFAULT_VARIANT_ID;
}

export function renamePose(profile: Profile, variantId: string, name: string): void {
  const v = mainLayer(profile).variants.find((x) => x.id === variantId);
  if (v) v.name = name;
}

export function setPoseTrigger(profile: Profile, variantId: string, trigger: string): void {
  const b = poseBinding(profile, variantId);
  if (b) b.trigger = trigger;
}
