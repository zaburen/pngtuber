// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { describe, expect, it, vi } from 'vitest';
import { Avatar } from './avatar';
import { mergeProfile, type MicSettings, type RenderState } from './types';

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

  it('binding overrides beat saved variant and visibility', () => {
    const { avatar, profile } = makeAvatar();
    avatar.frames = { 'hat.cap.idle': 'CAP', 'hat.none.idle': 'NONE' };
    profile.layers[1].visible = false; // hidden in the panel...
    avatar.overrides = new Map([['hat', { variantId: 'cap', visible: true }]]);
    expect(urlOf(avatar.state(), 'hat')).toBe('CAP'); // ...shown while bound key held
  });

  it('an override pointing at a deleted variant falls back to the saved one', () => {
    const { avatar } = makeAvatar();
    avatar.frames = { 'hat.cap.idle': 'CAP' };
    avatar.overrides = new Map([['hat', { variantId: 'gone' }]]);
    expect(urlOf(avatar.state(), 'hat')).toBe('CAP');
  });
});

// A stubbed mic + direct calls into the private tick, so the mic → talking →
// bounce timing is deterministic (no AudioContext, no requestAnimationFrame).
interface FakeMic {
  running: boolean;
  rms: () => number;
  stop: () => void;
}
function makeTiming(mic: Partial<MicSettings> = {}, look: Record<string, unknown> = {}) {
  const profile = mergeProfile({
    layers: [{ id: 'main', name: 'avatar', reactsToVoice: true, visible: true }],
  });
  Object.assign(profile.look, look);
  const states: RenderState[] = [];
  const av = new Avatar(profile, (s) => states.push(s));
  av.micSettings = { deviceId: '', enabled: true, threshold: 0.1, gain: 1, hold: 200, ...mic };
  const fake: FakeMic = { running: true, rms: () => 0, stop() {} };
  (av as unknown as { mic: FakeMic }).mic = fake;
  const tick = (now: number) => (av as unknown as { updateTalking(n: number): void }).updateTalking(now);
  return { av, states, mic: fake, profile, tick };
}

describe('Avatar mic timing', () => {
  it('goes talking when loud and bumps bounceSeq once on the idle->talking edge', () => {
    const { av, states, mic, tick } = makeTiming();
    mic.rms = () => 0.5;
    tick(1000);
    expect(av.talking).toBe(true);
    expect(states.at(-1)!.bounceSeq).toBe(1); // one bounce fired at talk start

    tick(1016); // still talking: no edge, no new bounce, no emit
    expect(states.at(-1)!.bounceSeq).toBe(1);
  });

  it('does not bump bounceSeq when bounce-on-talk is off', () => {
    const { av, states, mic, tick } = makeTiming({}, { bounce: false });
    mic.rms = () => 0.5;
    tick(1000);
    expect(av.talking).toBe(true);
    expect(states.at(-1)!.bounceSeq).toBe(0);
  });

  it('stays idle with the level zeroed when the mic is not running', () => {
    const { av, mic, tick } = makeTiming();
    mic.running = false;
    tick(1000);
    expect(av.talking).toBe(false);
    expect(av.level).toBe(0);
  });

  it('holds "talking" for `hold` ms after the level drops, then goes idle', () => {
    const { av, mic, tick } = makeTiming({ threshold: 0.1, gain: 1, hold: 200 });
    mic.rms = () => 0.11; // just over threshold
    tick(1000);
    expect(av.talking).toBe(true);

    mic.rms = () => 0; // quiet; level decays below threshold immediately
    tick(1050); // 50ms since last loud < hold -> still talking
    expect(av.talking).toBe(true);

    tick(1300); // 300ms since last loud > hold -> idle
    expect(av.talking).toBe(false);
  });
});

describe('Avatar timed (blink) scheduling', () => {
  it('plays a timed frame on schedule and clears it ~150ms later', () => {
    vi.useFakeTimers();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5); // wait = avg * 1.0
    try {
      // timedEvery 1s -> avg 1000ms; with random 0.5 the jittered wait is exactly 1000ms.
      const { av, states } = makeTiming({}, { timed: true, timedEvery: 1 });
      (av as unknown as { scheduleTimed(): void }).scheduleTimed();

      vi.advanceTimersByTime(1000); // timer fires -> timed frame shown
      expect(states.at(-1)!.placeholderFrame).toBe('idle-timed');

      vi.advanceTimersByTime(150); // timed clears back to idle
      expect(states.at(-1)!.placeholderFrame).toBe('idle');
    } finally {
      rand.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stop() cancels the pending timed-reset so no stray render fires afterward', () => {
    vi.useFakeTimers();
    vi.stubGlobal('cancelAnimationFrame', () => {}); // node env has no DOM raf
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { av, states } = makeTiming({}, { timed: true, timedEvery: 1 });
      (av as unknown as { scheduleTimed(): void }).scheduleTimed();

      vi.advanceTimersByTime(1000); // timed frame shown; the 150ms reset timer is now armed
      const countAtStop = states.length;

      av.stop(); // teardown (e.g. set switch) mid-timed-frame
      vi.advanceTimersByTime(1000); // the reset (and any reschedule) must not fire
      expect(states.length).toBe(countAtStop); // no emit after stop
    } finally {
      rand.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
