// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

import { beforeEach, describe, expect, it } from 'vitest';
import { Renderer } from './renderer';
import type { FrameKey, RenderLayer, RenderState } from './types';

function layer(partial: Partial<RenderLayer> & { id: string }): RenderLayer {
  return {
    url: `http://x/${partial.id}.png`,
    offsetX: 0,
    offsetY: 0,
    follow: false,
    scale: 1,
    main: false,
    ...partial,
  };
}

function state(
  layers: RenderLayer[],
  bounceSeq: number,
  extra: Partial<RenderState> = {},
): RenderState {
  return {
    layers,
    placeholder: false,
    placeholderFrame: 'idle' as FrameKey,
    scale: 1,
    pixelated: false,
    bounceSeq,
    bounceScale: 1,
    frame: { enabled: false, w: 300, h: 400 },
    ...extra,
  };
}

/** dataset.url basenames of the imgs in the container, in DOM (stacking) order. */
function stackOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img')].map((i) =>
    ((i as HTMLImageElement).dataset.url ?? '').split('/').pop() ?? '',
  );
}

/** The <img> the renderer created for a layer (matched by id in its url). */
function imgFor(container: HTMLElement, id: string): HTMLImageElement {
  const imgs = [...container.querySelectorAll('img')] as HTMLImageElement[];
  const found = imgs.find((i) => (i.dataset.url ?? '').includes(`/${id}.`));
  if (!found) throw new Error(`no img for layer ${id}`);
  return found;
}

describe('Renderer bounce class lifecycle', () => {
  let container: HTMLDivElement;
  let r: Renderer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    r = new Renderer(container); // no viewport: behaves like the OBS overlay
  });

  it('adds the bounce class to a following layer when a bounce fires', () => {
    r.render(state([layer({ id: 'main', main: true, follow: true })], 1));
    expect(imgFor(container, 'main').classList.contains('bounce')).toBe(true);
  });

  it('never bounces a non-following layer', () => {
    r.render(
      state(
        [layer({ id: 'main', main: true, follow: true }), layer({ id: 'bg', follow: false })],
        1,
      ),
    );
    expect(imgFor(container, 'bg').classList.contains('bounce')).toBe(false);
  });

  // Regression (bug 1): unchecking "move with the character" used to leave the
  // layer bobbing forever — the bounce class was never stripped once it stopped
  // following (it was only removed just before being re-added on a bounce).
  it('removes a lingering bounce class when a layer stops following', () => {
    r.render(state([layer({ id: 'bg', follow: true })], 1));
    expect(imgFor(container, 'bg').classList.contains('bounce')).toBe(true);

    // Same bounceSeq (no new bounce), but the layer no longer follows.
    r.render(state([layer({ id: 'bg', follow: false })], 1));
    expect(imgFor(container, 'bg').classList.contains('bounce')).toBe(false);
  });

  // Regression (bug 2): the bounce must clean itself up when its animation ends,
  // so a later re-render can't replay a stale animation.
  it('self-removes the bounce class on animationend', () => {
    r.render(state([layer({ id: 'main', main: true, follow: true })], 1));
    const img = imgFor(container, 'main');
    expect(img.classList.contains('bounce')).toBe(true);

    img.dispatchEvent(new Event('animationend'));
    expect(img.classList.contains('bounce')).toBe(false);
  });

  // Regression (bug 2): after a bounce has ended, a blink (frame swap with the
  // SAME bounceSeq) must not carry a bounce class that a browser would replay —
  // otherwise the avatar bobs on every blink after the first word.
  it('does not re-bounce on a blink (frame change without a new bounceSeq)', () => {
    r.render(
      state([layer({ id: 'main', main: true, follow: true, url: 'http://x/main.idle.png' })], 1),
    );
    const img = imgFor(container, 'main');
    img.dispatchEvent(new Event('animationend')); // the talk-start bounce finishes
    expect(img.classList.contains('bounce')).toBe(false);

    // A blink: same layer + new frame url, but bounceSeq is unchanged.
    r.render(
      state(
        [layer({ id: 'main', main: true, follow: true, url: 'http://x/main.idle-timed.png' })],
        1,
      ),
    );
    expect(img.classList.contains('bounce')).toBe(false);
  });
});

describe('Renderer DOM composition', () => {
  let container: HTMLDivElement;
  let r: Renderer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    r = new Renderer(container);
  });

  it('draws layers bottom-to-top in the state order, and reorders on change', () => {
    r.render(state([layer({ id: 'a' }), layer({ id: 'b' }), layer({ id: 'c' })], 0));
    expect(stackOrder(container)).toEqual(['a.png', 'b.png', 'c.png']);

    // Reorder the stack; the DOM order must follow.
    r.render(state([layer({ id: 'c' }), layer({ id: 'a' }), layer({ id: 'b' })], 0));
    expect(stackOrder(container)).toEqual(['c.png', 'a.png', 'b.png']);
  });

  it('adds and removes img elements as layers come and go', () => {
    r.render(state([layer({ id: 'a' }), layer({ id: 'b' })], 0));
    expect(container.querySelectorAll('img')).toHaveLength(2);

    // Drop b: its img is removed.
    r.render(state([layer({ id: 'a' })], 0));
    expect(stackOrder(container)).toEqual(['a.png']);

    // Add c: a stays, c appears.
    r.render(state([layer({ id: 'a' }), layer({ id: 'c' })], 0));
    expect(stackOrder(container)).toEqual(['a.png', 'c.png']);
  });

  it('marks a layer active only when it has a url (hidden layers are not shown)', () => {
    r.render(state([layer({ id: 'a', url: 'http://x/a.png' })], 0));
    const img = container.querySelector('img')!;
    expect(img.classList.contains('active')).toBe(true);

    // Hidden: no url -> not active (element kept, just not drawn).
    r.render(state([layer({ id: 'a', url: null })], 0));
    expect(img.classList.contains('active')).toBe(false);
  });

  it('toggles the pixelated class on the container per state', () => {
    r.render(state([layer({ id: 'a' })], 0, { pixelated: true }));
    expect(container.classList.contains('pixelated')).toBe(true);

    r.render(state([layer({ id: 'a' })], 0, { pixelated: false }));
    expect(container.classList.contains('pixelated')).toBe(false);
  });

  it('sets --bounce-amp from bounceScale (the bounce-height slider)', () => {
    r.render(state([layer({ id: 'a' })], 0, { bounceScale: 1 }));
    expect(container.style.getPropertyValue('--bounce-amp')).toBe('14px');

    r.render(state([layer({ id: 'a' })], 0, { bounceScale: 2 }));
    expect(container.style.getPropertyValue('--bounce-amp')).toBe('28px');
  });

  it('applies the per-layer nudge scaled by the global scale', () => {
    r.render(state([layer({ id: 'a', offsetX: 10, offsetY: -5 })], 0, { scale: 2 }));
    const img = container.querySelector('img')!;
    // offset (source px) is multiplied by the global scale, added to the centering.
    expect(img.style.translate).toBe('calc(-50% + 20px) calc(-50% + -10px)');
  });
});

// The overlay (no viewport) hard-crops by sizing the origin box; the preview
// (with a viewport) never clips and instead draws a .frame-guide rectangle.
describe('Renderer output frame (crop)', () => {
  const withFrame = (w: number, h: number, enabled = true) =>
    state([layer({ id: 'a' })], 0, { frame: { enabled, w, h } });

  describe('overlay (no viewport): clips to the frame', () => {
    let container: HTMLDivElement;
    let r: Renderer;
    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      r = new Renderer(container);
    });

    it('sizes the origin box to w×h and hides overflow when enabled', () => {
      r.render(withFrame(300, 400));
      expect(container.style.width).toBe('300px');
      expect(container.style.height).toBe('400px');
      expect(container.style.overflow).toBe('hidden');
    });

    it('clears the crop when the frame is turned off', () => {
      r.render(withFrame(300, 400));
      r.render(withFrame(300, 400, false));
      expect(container.style.width).toBe('');
      expect(container.style.height).toBe('');
      expect(container.style.overflow).toBe('');
    });

    it('never draws the preview guide element', () => {
      r.render(withFrame(300, 400));
      expect(container.querySelector('.frame-guide')).toBeNull();
    });
  });

  describe('preview (with viewport): guide only, no clip', () => {
    let container: HTMLDivElement;
    let viewport: HTMLDivElement;
    let r: Renderer;
    beforeEach(() => {
      viewport = document.createElement('div');
      container = document.createElement('div');
      viewport.appendChild(container);
      document.body.appendChild(viewport);
      r = new Renderer(container, viewport);
    });

    it('adds a guide sized to the frame and does not clip the origin box', () => {
      r.render(withFrame(300, 400));
      const guide = container.querySelector<HTMLElement>('.frame-guide')!;
      expect(guide).not.toBeNull();
      expect(guide.style.width).toBe('300px');
      expect(guide.style.height).toBe('400px');
      expect(container.style.overflow).toBe(''); // preview shows the bleed
    });

    it('keeps the guide above the layers (appended last)', () => {
      r.render(withFrame(300, 400));
      expect(container.lastElementChild?.classList.contains('frame-guide')).toBe(true);
    });

    it('removes the guide when the frame is turned off', () => {
      r.render(withFrame(300, 400));
      r.render(withFrame(300, 400, false));
      expect(container.querySelector('.frame-guide')).toBeNull();
    });
  });
});
