// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Framework-free avatar renderer shared by the in-app preview and the OBS
 * overlay page. Owns one <img> per frame key inside `container` and toggles
 * which one is visible.
 */
import { FRAME_KEYS, type FrameKey, type RenderState } from './types';

export class Renderer {
  private imgs = {} as Record<FrameKey, HTMLImageElement>;
  private urls = {} as Record<FrameKey, string | null>;
  private lastBounce = 0;
  private scale = 1;

  constructor(private container: HTMLElement) {
    container.classList.add('avatar');
    for (const k of FRAME_KEYS) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.onload = () => this.applyScale(img);
      container.appendChild(img);
      this.imgs[k] = img;
      this.urls[k] = null;
    }
  }

  render(s: RenderState) {
    this.scale = s.scale;
    this.container.classList.toggle('pixelated', s.pixelated);
    for (const k of FRAME_KEYS) {
      const want = s.frames[k] ?? placeholder(k);
      if (this.urls[k] !== want) {
        this.urls[k] = want;
        this.imgs[k].src = want;
      }
      this.applyScale(this.imgs[k]);
    }
    const use = resolveFrame(s.frame, s.frames);
    for (const k of FRAME_KEYS) this.imgs[k].classList.toggle('active', k === use);

    if (s.bounceSeq !== this.lastBounce) {
      this.lastBounce = s.bounceSeq;
      this.container.classList.remove('bounce');
      void this.container.offsetWidth; // restart the CSS animation
      this.container.classList.add('bounce');
    }
  }

  private applyScale(img: HTMLImageElement) {
    if (img.naturalWidth) img.style.width = img.naturalWidth * this.scale + 'px';
  }
}

/**
 * Pick the frame to show given which ones the user actually supplied:
 * missing blink → non-blink variant, missing talking → idle.
 */
export function resolveFrame(want: FrameKey, frames: Record<FrameKey, string | null>): FrameKey {
  const any = FRAME_KEYS.some((k) => frames[k]);
  if (!any) return want; // all placeholders, which cover every state
  if (frames[want]) return want;
  const base: FrameKey = want.startsWith('talking') ? 'talking' : 'idle';
  if (frames[base]) return base;
  return 'idle';
}

const placeholders: Partial<Record<FrameKey, string>> = {};
/** Drawn stand-in so the app visibly works before any art is loaded. */
export function placeholder(k: FrameKey): string {
  const cached = placeholders[k];
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e8b06a'; x.fillRect(8, 6, 16, 16); // head
  x.fillStyle = '#5a3b1e'; x.fillRect(8, 4, 16, 4); // hair
  x.fillStyle = '#3a6ea5'; x.fillRect(6, 22, 20, 10); // body
  x.fillStyle = '#222';
  if (k.includes('blink')) { x.fillRect(11, 13, 3, 1); x.fillRect(18, 13, 3, 1); }
  else { x.fillRect(11, 11, 3, 3); x.fillRect(18, 11, 3, 3); }
  if (k.startsWith('talking')) { x.fillStyle = '#7a2020'; x.fillRect(13, 17, 6, 4); }
  else { x.fillRect(13, 18, 6, 1); }
  return (placeholders[k] = c.toDataURL());
}

/** CSS the renderer relies on; include once per page. */
export const RENDERER_CSS = `
.avatar { position: relative; display: inline-block; }
.avatar img { display: none; position: absolute; left: 50%; top: 50%; translate: -50% -50%; }
.avatar.pixelated img { image-rendering: pixelated; }
.avatar img.active { display: block; }
.avatar.bounce { animation: avatar-bounce 0.22s ease-out; }
@keyframes avatar-bounce { 0% { transform: translateY(0); } 40% { transform: translateY(-14px); } 100% { transform: translateY(0); } }
`;
