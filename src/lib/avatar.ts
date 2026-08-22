/**
 * Avatar state machine: mic level → talking, timer → blink. Produces a
 * RenderState whenever something visible changes.
 */
import { Mic } from './mic';
import type { FrameKey, Profile, RenderState } from './types';

export class Avatar {
  readonly mic = new Mic();
  profile: Profile;
  frames: Record<FrameKey, string | null> = {
    idle: null,
    talking: null,
    'idle-blink': null,
    'talking-blink': null,
  };
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

  state(): RenderState {
    const frame = ((this.talking ? 'talking' : 'idle') + (this.blinking ? '-blink' : '')) as FrameKey;
    return {
      frame,
      frames: { ...this.frames },
      scale: this.profile.look.scale,
      pixelated: this.profile.look.pixelated,
      bounceSeq: this.bounceSeq,
    };
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
