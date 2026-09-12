// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Avatar state machine: mic level → talking, timer → blink. Resolves the
 * current voice state against the layer stack and produces a RenderState
 * whenever something visible changes.
 */
import { Mic } from './mic';
import {
  frameStorageKey,
  type FrameKey,
  type Profile,
  type RenderLayer,
  type RenderState,
} from './types';

export class Avatar {
  readonly mic = new Mic();
  profile: Profile;
  /** frameStorageKey(layerId, frame) → image URL, for frames that exist. */
  frames: Record<string, string> = {};
  /** Smoothed, gain-applied mic level for the meter. */
  level = 0;
  talking = false;
  private blinking = false;
  private lastLoudAt = 0;
  private bounceSeq = 0;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private lastSent = '';

  constructor(
    profile: Profile,
    private onRender: (s: RenderState) => void,
  ) {
    this.profile = profile;
  }

  start() {
    this.scheduleBlink();
    const tick = (now: number) => {
      this.updateTalking(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    this.mic.stop();
  }

  /** Call after mutating `profile` or `frames`. */
  emit(force = false) {
    const s = this.state();
    const json = JSON.stringify(s);
    if (!force && json === this.lastSent) return;
    this.lastSent = json;
    this.onRender(s);
  }

  get voiceState(): FrameKey {
    return ((this.talking ? 'talking' : 'idle') + (this.blinking ? '-blink' : '')) as FrameKey;
  }

  state(): RenderState {
    const want = this.voiceState;
    const layers: RenderLayer[] = this.profile.layers.map((l) => ({
      id: l.id,
      url: l.visible ? this.resolve(l.id, l.reactsToVoice ? want : 'idle') : null,
    }));
    return {
      layers,
      placeholder: Object.keys(this.frames).length === 0,
      placeholderFrame: want,
      scale: this.profile.look.scale,
      pixelated: this.profile.look.pixelated,
      bounceSeq: this.bounceSeq,
    };
  }

  /**
   * Pick the image a layer shows for a voice state, falling back through
   * missing frames: no blink variant → non-blink, no talking → idle.
   */
  private resolve(layerId: string, want: FrameKey): string | null {
    const chain: FrameKey[] = want.includes('blink')
      ? [want, want.startsWith('talking') ? 'talking' : 'idle', 'idle']
      : [want, 'idle'];
    for (const f of chain) {
      const url = this.frames[frameStorageKey(layerId, f)];
      if (url) return url;
    }
    return null;
  }

  private updateTalking(now: number) {
    const { threshold, gain, hold } = this.profile.mic;
    if (this.mic.running) {
      const rms = this.mic.rms() * gain;
      this.level = Math.max(rms, this.level * 0.85); // fast attack, smooth release
      if (this.level > threshold) this.lastLoudAt = now;
      this.setTalking(this.level > threshold || now - this.lastLoudAt < hold);
    } else {
      this.level = 0;
      this.setTalking(false);
    }
  }

  private setTalking(v: boolean) {
    if (v === this.talking) return;
    this.talking = v;
    if (v && this.profile.look.bounce) this.bounceSeq++;
    this.emit();
  }

  private scheduleBlink() {
    const wait = 2000 + Math.random() * 5000;
    this.blinkTimer = setTimeout(() => {
      if (this.profile.look.blink) {
        this.blinking = true;
        this.emit();
        setTimeout(() => {
          this.blinking = false;
          this.emit();
        }, 150);
      }
      this.scheduleBlink();
    }, wait);
  }
}
