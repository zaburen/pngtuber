// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Framework-free avatar renderer shared by the in-app preview and the OBS
 * overlay page. Keeps one <img> per render layer inside `container`, stacked
 * bottom → top, all centered on the same origin.
 */
import type { FrameKey, RenderState } from './types';

export class Renderer {
  /** layer id → its img element (insertion order = stacking order). */
  private imgs = new Map<string, HTMLImageElement>();
  private lastBounce = 0;
  private scale = 1;

  constructor(private container: HTMLElement) {
    container.classList.add('avatar');
  }

  render(s: RenderState) {
    this.scale = s.scale;
    this.container.classList.toggle('pixelated', s.pixelated);

    const want = s.placeholder
      ? [{ id: '__placeholder', url: placeholder(s.placeholderFrame) }]
      : s.layers;

    // Drop imgs for layers that no longer exist.
    const ids = new Set(want.map((l) => l.id));
    for (const [id, img] of this.imgs) {
      if (!ids.has(id)) {
        img.remove();
        this.imgs.delete(id);
      }
    }

    for (const l of want) {
      let img = this.imgs.get(l.id);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.onload = () => this.applyScale(img!);
        this.imgs.set(l.id, img);
      }
      // Re-append in order: cheap way to keep DOM order = stack order even
      // after layers are added, removed, or reordered.
      this.container.appendChild(img);
      const url = l.url ?? '';
      if (img.dataset.url !== url) {
        img.dataset.url = url;
        if (url) img.src = url;
      }
      img.classList.toggle('active', !!url);
      this.applyScale(img);
    }

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
  if (k.includes('timed')) { x.fillRect(11, 13, 3, 1); x.fillRect(18, 13, 3, 1); }
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
