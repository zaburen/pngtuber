// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

/**
 * Binding engine: turns global-input trigger events into per-layer runtime
 * overrides. Overrides sit on top of the saved profile — a binding never
 * writes to layer config or disk, so releasing a key always restores exactly
 * what the panel shows.
 */
import type { Binding } from './types';

export interface LayerOverride {
  variantId?: string;
  visible?: boolean;
}

export class BindingEngine {
  /** Ids of bindings currently applied (key held, or toggled on). */
  private active = new Set<string>();

  /** Feed one trigger event. Returns true if any binding changed state. */
  handle(bindings: Binding[], trigger: string, down: boolean): boolean {
    let changed = false;
    for (const b of bindings) {
      if (b.trigger !== trigger) continue;
      const was = this.active.has(b.id);
      const now = b.mode === 'hold' ? down : down ? !was : was;
      if (now === was) continue;
      if (now) this.active.add(b.id);
      else this.active.delete(b.id);
      changed = true;
    }
    return changed;
  }

  /** Drop active state for bindings that were removed or edited away. */
  prune(bindings: Binding[]): boolean {
    const ids = new Set(bindings.map((b) => b.id));
    let changed = false;
    for (const id of [...this.active]) {
      if (!ids.has(id)) {
        this.active.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /**
   * Per-layer overrides from the active bindings, in binding order (a later
   * binding on the same layer wins). A variant override implies visible —
   * "press button, show the cap" is one binding, not two.
   */
  overrides(bindings: Binding[]): Map<string, LayerOverride> {
    const out = new Map<string, LayerOverride>();
    for (const b of bindings) {
      if (!this.active.has(b.id)) continue;
      const ov = out.get(b.layerId) ?? {};
      if (b.action === 'variant') {
        ov.variantId = b.variantId;
        ov.visible = true;
      } else {
        ov.visible = b.action === 'show';
      }
      out.set(b.layerId, ov);
    }
    return out;
  }
}
