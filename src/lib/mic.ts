// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/** Microphone capture + RMS level. Talking detection lives in avatar.ts. */
export class Mic {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private buf = new Float32Array(2048);
  label = '';

  get running() {
    return this.analyser !== null;
  }

  static async list(): Promise<MediaDeviceInfo[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    } catch (e) {
      console.warn('enumerateDevices failed', e);
      return [];
    }
  }

  /** Throws with a readable message on failure. */
  async start(deviceId: string): Promise<void> {
    this.stop();
    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (!deviceId) throw e;
      // Saved device gone (unplugged headset) — fall back to the default mic.
      console.warn('saved mic unavailable, falling back to default:', (e as Error).name);
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.buf.length;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.label = this.stream.getAudioTracks()[0]?.label || 'unknown device';
    console.log('mic started:', this.label);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = this.ctx = this.analyser = null;
    this.label = '';
  }

  /** Raw RMS of the latest audio window, roughly 0..1. */
  rms(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }
}
