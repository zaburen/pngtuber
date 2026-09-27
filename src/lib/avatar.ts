// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Avatar state machine: mic level → talking, timer → timed frame. Resolves the
 * current voice state against the layer stack and produces a RenderState
 * whenever something visible changes.
 */
import type { LayerOverride } from './bindings';
import { Mic } from './mic';
import {
  DEFAULT_MIC,
  frameStorageKey,
  type FrameKey,
  type MicSettings,
  type Profile,
  type RenderLayer,
  type RenderState,
} from './types';

export class Avatar {
  readonly mic = new Mic();
  profile: Profile;
  /** Mic tuning (global, shared across sets). Set by the control panel. */
  micSettings: MicSettings = { ...DEFAULT_MIC };
  /** frameStorageKey(layerId, frame) → image URL, for frames that exist. */
  frames: Record<string, string> = {};
  /** Runtime overrides from input bindings; call emit() after replacing. */
  overrides: Map<string, LayerOverride> = new Map();
  /** Smoothed, gain-applied mic level for the meter. */
  level = 0;
  talking = false;
  private timed = false;
  private lastLoudAt = 0;
  private bounceSeq = 0;
  private timedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Inner timer that clears a timed frame ~150ms after it shows. */
  private timedResetTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private lastSent = '';

  constructor(
    profile: Profile,
    private onRender: (s: RenderState) => void,
  ) {
    this.profile = profile;
  }

  start() {
    this.scheduleTimed();
    const tick = (now: number) => {
      this.updateTalking(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.timedTimer) clearTimeout(this.timedTimer);
    if (this.timedResetTimer) clearTimeout(this.timedResetTimer);
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
    return ((this.talking ? 'talking' : 'idle') + (this.timed ? '-timed' : '')) as FrameKey;
  }

  state(): RenderState {
    const want = this.voiceState;
    const layers: RenderLayer[] = this.profile.layers.map((l) => {
      const ov = this.overrides.get(l.id);
      const visible = ov?.visible ?? l.visible;
      const variant =
        ov?.variantId && l.variants.some((v) => v.id === ov.variantId)
          ? ov.variantId
          : l.activeVariant;
      return {
        id: l.id,
        url: visible ? this.resolve(l.id, variant, l.reactsToVoice ? want : 'idle') : null,
        offsetX: l.offset.x,
        offsetY: l.offset.y,
        // The voice-reactive main layer always bounces; props bounce only if they follow.
        follow: l.reactsToVoice || l.followBounce,
        scale: l.scale,
        main: l.reactsToVoice,
      };
    });
    return {
      layers,
      placeholder: Object.keys(this.frames).length === 0,
      placeholderFrame: want,
      scale: this.profile.look.scale,
      pixelated: this.profile.look.pixelated,
      bounceSeq: this.bounceSeq,
      bounceScale: this.profile.look.bounceScale,
    };
  }

  /**
   * Pick the image a layer shows for a voice state, falling back through
   * missing frames: no timed variant → non-timed, no talking → idle.
   */
  private resolve(layerId: string, variantId: string, want: FrameKey): string | null {
    const chain: FrameKey[] = want.includes('timed')
      ? [want, want.startsWith('talking') ? 'talking' : 'idle', 'idle']
      : [want, 'idle'];
    for (const f of chain) {
      const url = this.frames[frameStorageKey(layerId, variantId, f)];
      if (url) return url;
    }
    return null;
  }

  private updateTalking(now: number) {
    const { threshold, gain, hold } = this.micSettings;
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

  private scheduleTimed() {
    // Jitter ±40% around the configured average so it doesn't feel metronomic.
    const avg = Math.max(0.5, this.profile.look.timedEvery) * 1000;
    const wait = avg * (0.6 + Math.random() * 0.8);
    this.timedTimer = setTimeout(() => {
      if (this.profile.look.timed) {
        this.timed = true;
        this.emit();
        this.timedResetTimer = setTimeout(() => {
          this.timed = false;
          this.emit();
        }, 150);
      }
      this.scheduleTimed();
    }, wait);
  }
}
