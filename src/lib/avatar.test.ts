// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it } from 'vitest';
import { Avatar } from './avatar';
import { mergeProfile, type RenderState } from './types';

function makeAvatar() {
  const profile = mergeProfile({
    layers: [
      {
        id: 'main', name: 'avatar', reactsToVoice: true, visible: true,
        variants: [{ id: 'default', name: 'default' }, { id: 'alt', name: 'alt' }],
        activeVariant: 'default',
      },
      {
        id: 'hat', name: 'hat', reactsToVoice: false, visible: true,
        variants: [{ id: 'none', name: 'none' }, { id: 'cap', name: 'cap' }],
        activeVariant: 'cap',
      },
    ],
  });
  const avatar = new Avatar(profile, () => {});
  return { avatar, profile };
}

const urlOf = (s: RenderState, id: string) => s.layers.find((l) => l.id === id)?.url;

describe('Avatar.state', () => {
  it('resolves each layer through its active variant', () => {
    const { avatar } = makeAvatar();
    avatar.frames = { 'main.default.idle': 'IDLE', 'hat.cap.idle': 'CAP' };
    const s = avatar.state();
    expect(urlOf(s, 'main')).toBe('IDLE');
    expect(urlOf(s, 'hat')).toBe('CAP');
  });

  it('renders nothing for a variant with no images (empty "none" variant)', () => {
    const { avatar, profile } = makeAvatar();
    avatar.frames = { 'main.default.idle': 'IDLE', 'hat.cap.idle': 'CAP' };
    profile.layers[1].activeVariant = 'none';
    expect(urlOf(avatar.state(), 'hat')).toBeNull();
  });

  it('falls back talking -> idle when the talking frame is missing', () => {
    const { avatar } = makeAvatar();
    avatar.frames = { 'main.default.idle': 'IDLE' };
    avatar.talking = true;
    expect(urlOf(avatar.state(), 'main')).toBe('IDLE');
  });

  it('uses the talking frame when present', () => {
    const { avatar } = makeAvatar();
    avatar.frames = { 'main.default.idle': 'IDLE', 'main.default.talking': 'TALK' };
    avatar.talking = true;
    expect(urlOf(avatar.state(), 'main')).toBe('TALK');
  });

  it('non-voice layers ignore talking', () => {
    const { avatar } = makeAvatar();
    avatar.frames = { 'hat.cap.idle': 'CAP', 'hat.cap.talking': 'CAP-TALK' };
    avatar.talking = true;
    expect(urlOf(avatar.state(), 'hat')).toBe('CAP');
  });

  it('hidden layers resolve to null', () => {
    const { avatar, profile } = makeAvatar();
    avatar.frames = { 'hat.cap.idle': 'CAP' };
    profile.layers[1].visible = false;
    expect(urlOf(avatar.state(), 'hat')).toBeNull();
  });

  it('flags placeholder only when no frames exist at all', () => {
    const { avatar } = makeAvatar();
    expect(avatar.state().placeholder).toBe(true);
    avatar.frames = { 'main.default.idle': 'IDLE' };
    expect(avatar.state().placeholder).toBe(false);
  });
});
