// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { addPose, listPoses, removePose, renamePose, setPoseTrigger } from './poses';
import { DEFAULT_VARIANT_ID, mainLayer, mergeProfile } from './types';

const fresh = () => mergeProfile(null);

describe('poses', () => {
  it('a fresh profile has no poses (only the base default variant)', () => {
    expect(listPoses(fresh())).toEqual([]);
  });

  it('addPose adds a main-layer variant and an unbound hold binding', () => {
    const p = fresh();
    const pose = addPose(p);
    const main = mainLayer(p);
    expect(main.variants.some((v) => v.id === pose.id)).toBe(true);
    expect(main.activeVariant).toBe(DEFAULT_VARIANT_ID); // base stays active
    const b = p.bindings.find((b) => b.id === pose.bindingId);
    expect(b).toMatchObject({ layerId: main.id, action: 'variant', variantId: pose.id, mode: 'hold', trigger: '' });
  });

  it('listPoses reflects the pose and its trigger once set', () => {
    const p = fresh();
    const pose = addPose(p);
    setPoseTrigger(p, pose.id, 'pad:South');
    const poses = listPoses(p);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ id: pose.id, trigger: 'pad:South' });
  });

  it('renamePose updates the variant name', () => {
    const p = fresh();
    const pose = addPose(p);
    renamePose(p, pose.id, 'controller A');
    expect(listPoses(p)[0].name).toBe('controller A');
  });

  it('removePose drops the variant and its binding', () => {
    const p = fresh();
    const pose = addPose(p);
    removePose(p, pose.id);
    expect(listPoses(p)).toEqual([]);
    expect(p.bindings.some((b) => b.variantId === pose.id)).toBe(false);
  });

  it('removing the active pose resets the base to default', () => {
    const p = fresh();
    const pose = addPose(p);
    mainLayer(p).activeVariant = pose.id;
    removePose(p, pose.id);
    expect(mainLayer(p).activeVariant).toBe(DEFAULT_VARIANT_ID);
  });

  it('supports several independent poses', () => {
    const p = fresh();
    const a = addPose(p, 'A');
    const b = addPose(p, 'B');
    setPoseTrigger(p, a.id, 'pad:South');
    setPoseTrigger(p, b.id, 'pad:East');
    const poses = listPoses(p);
    expect(poses.map((x) => x.name)).toEqual(['A', 'B']);
    expect(poses.map((x) => x.trigger)).toEqual(['pad:South', 'pad:East']);
  });
});
