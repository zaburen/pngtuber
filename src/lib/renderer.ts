// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Framework-free avatar renderer shared by the in-app preview and the OBS
 * overlay page. Keeps one <img> per render layer inside `container`, stacked
 * bottom → top, all centered on the same origin.
 */
import type { FrameKey, RenderLayer, RenderState } from './types';

export class Renderer {
  /** layer id → its img element (insertion order = stacking order). */
  private imgs = new Map<string, HTMLImageElement>();
  private lastBounce = 0;
  private scale = 1;
  private frame: RenderState['frame'] = { enabled: false, w: 0, h: 0 };
  /** Preview-only crop guide (border + dimmed bleed); null when off / on overlay. */
  private guide: HTMLDivElement | null = null;

  /**
   * @param container element the layers are drawn into.
   * @param viewport  when given (in-app preview), the composition is scaled
   *   down to fit this element; omitted for the OBS overlay, which stays true-size.
   */
  constructor(
    private container: HTMLElement,
    private viewport: HTMLElement | null = null,
  ) {
    container.classList.add('avatar');
    if (viewport && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.fit()).observe(viewport);
    }
  }

  render(s: RenderState) {
    this.scale = s.scale;
    this.frame = s.frame;
    this.container.classList.toggle('pixelated', s.pixelated);
    // Bounce amplitude (px) the keyframe reads via var(--bounce-amp).
    this.container.style.setProperty('--bounce-amp', `${14 * s.bounceScale}px`);

    const want: RenderLayer[] = s.placeholder
      ? [{ id: '__placeholder', url: placeholder(s.placeholderFrame), offsetX: 0, offsetY: 0, follow: true, scale: 1, main: true }]
      : s.layers;

    // Drop imgs for layers that no longer exist.
    const ids = new Set(want.map((l) => l.id));
    for (const [id, img] of this.imgs) {
      if (!ids.has(id)) {
        img.remove();
        this.imgs.delete(id);
      }
    }

    const bounced = s.bounceSeq !== this.lastBounce;
    this.lastBounce = s.bounceSeq;

    for (const l of want) {
      let img = this.imgs.get(l.id);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.onload = () => { this.applyScale(img!); this.fit(); };
        // A bounce plays exactly once per talk-start. Drop the class as soon as
        // the animation ends so it never lingers on the element — otherwise a
        // later re-render (e.g. a blink swapping the frame) replays the stale
        // animation, making the avatar bob on every blink after the first word.
        img.addEventListener('animationend', () => img!.classList.remove('bounce'));
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
      img.dataset.ox = String(l.offsetX);
      img.dataset.oy = String(l.offsetY);
      img.dataset.ls = String(l.scale);
      img.dataset.main = l.main ? '1' : '';
      this.applyScale(img);
      // Bounce only the layers that follow the character (main + following props).
      if (bounced && l.follow) {
        img.classList.remove('bounce');
        void img.offsetWidth; // restart the CSS animation
        img.classList.add('bounce');
      } else if (!l.follow) {
        // Stopped following (e.g. "move with the character" unchecked): drop any
        // lingering bounce class so the layer settles to rest instead of bobbing on.
        img.classList.remove('bounce');
      }
    }
    this.applyFrame();
    this.fit();
  }

  /**
   * Apply the output crop. The overlay hard-crops: sizing the origin box to
   * w×h with `overflow:hidden` clips everything outside it (layers are centered
   * on that box's center). The preview never clips — it draws a guide rectangle
   * that outlines the frame and dims whatever bleeds past it.
   */
  private applyFrame() {
    const { enabled, w, h } = this.frame;
    if (!this.viewport) {
      // Overlay: crop by constraining the origin box.
      this.container.style.width = enabled ? `${w}px` : '';
      this.container.style.height = enabled ? `${h}px` : '';
      this.container.style.overflow = enabled ? 'hidden' : '';
      return;
    }
    // Preview: show everything; the guide marks the crop.
    if (!enabled) {
      this.guide?.remove();
      this.guide = null;
      return;
    }
    if (!this.guide) {
      this.guide = document.createElement('div');
      this.guide.className = 'frame-guide';
    }
    this.guide.style.width = `${w}px`;
    this.guide.style.height = `${h}px`;
    this.container.appendChild(this.guide); // re-append last so it sits above the layers
  }

  private applyScale(img: HTMLImageElement) {
    const ls = Number(img.dataset.ls ?? 1);
    if (img.naturalWidth) img.style.width = img.naturalWidth * this.scale * ls + 'px';
    const ox = Number(img.dataset.ox ?? 0) * this.scale;
    const oy = Number(img.dataset.oy ?? 0) * this.scale;
    // `translate` centers + nudges; `transform` is left free for the bounce keyframes.
    img.style.translate = `calc(-50% + ${ox}px) calc(-50% + ${oy}px)`;
  }

  /**
   * Preview only: shrink the whole composition so it fits `viewport`, never
   * enlarging past true size. Centered on the same origin the layers use.
   */
  private fit() {
    if (!this.viewport) return;
    let cw = 0;
    let ch = 0;
    if (this.frame.enabled) {
      // Frame on: fit the crop rectangle to the viewport so the whole frame (and
      // the dimmed bleed around it) is always in view.
      cw = this.frame.w;
      ch = this.frame.h;
    } else {
      const active = [...this.imgs.values()].filter(
        (i) => i.classList.contains('active') && i.naturalWidth,
      );
      // Anchor the zoom to the character so resizing a background doesn't move it.
      const anchor = active.filter((i) => i.dataset.main === '1');
      const use = anchor.length ? anchor : active;
      for (const img of use) {
        const ls = Number(img.dataset.ls ?? 1);
        const w = img.naturalWidth * this.scale * ls;
        const h = img.naturalHeight * this.scale * ls;
        const ox = Math.abs(Number(img.dataset.ox ?? 0) * this.scale);
        const oy = Math.abs(Number(img.dataset.oy ?? 0) * this.scale);
        cw = Math.max(cw, w + 2 * ox);
        ch = Math.max(ch, h + 2 * oy);
      }
    }
    const availW = this.viewport.clientWidth - 24;
    const availH = this.viewport.clientHeight - 24;
    const f = cw > 0 && ch > 0 ? Math.min(1, availW / cw, availH / ch) : 1;
    this.container.style.transform = f < 1 ? `scale(${f})` : 'none';
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
.avatar img.bounce { animation: avatar-bounce 0.22s ease-out; }
@keyframes avatar-bounce { 0% { transform: translateY(0); } 40% { transform: translateY(calc(var(--bounce-amp, 14px) * -1)); } 100% { transform: translateY(0); } }
/* Preview crop guide: a border marks the exported region; the outward shadow
   dims everything that bleeds past it. Preview only — the overlay never makes it. */
.avatar .frame-guide { position: absolute; left: 50%; top: 50%; translate: -50% -50%; box-sizing: border-box; pointer-events: none; border: 1px solid #6ea8fe; box-shadow: 0 0 0 9999px rgba(16, 18, 23, 0.6); }
`;
