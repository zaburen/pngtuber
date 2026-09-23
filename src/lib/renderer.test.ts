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

function state(layers: RenderLayer[], bounceSeq: number): RenderState {
  return {
    layers,
    placeholder: false,
    placeholderFrame: 'idle' as FrameKey,
    scale: 1,
    pixelated: false,
    bounceSeq,
    bounceScale: 1,
  };
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
