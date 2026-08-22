export const FRAME_KEYS = ['idle', 'talking', 'idle-blink', 'talking-blink'] as const;
export type FrameKey = (typeof FRAME_KEYS)[number];

export const OVERLAY_PORT = 8737;
export const OVERLAY_ORIGIN = `http://127.0.0.1:${OVERLAY_PORT}`;

export interface Profile {
  version: 1;
  mic: {
    deviceId: string;
    enabled: boolean;
    threshold: number;
    gain: number;
    /** ms to keep "talking" after the level drops below threshold */
    hold: number;
  };
  look: {
    scale: number;
    pixelated: boolean;
    bounce: boolean;
    blink: boolean;
  };
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  mic: { deviceId: '', enabled: true, threshold: 0.12, gain: 2.0, hold: 180 },
  look: { scale: 4, pixelated: true, bounce: true, blink: true },
};

/** Everything an overlay needs to draw one frame. Sent over the WebSocket. */
export interface RenderState {
  frame: FrameKey;
  /** Frame key → image URL (null = not provided, renderer falls back). */
  frames: Record<FrameKey, string | null>;
  scale: number;
  pixelated: boolean;
  /** Increments every time a bounce should play. */
  bounceSeq: number;
}

/** Merge a stored profile over the defaults so fields added later get values. */
export function mergeProfile(stored: unknown): Profile {
  const s = (stored ?? {}) as Partial<Profile>;
  return {
    version: 1,
    mic: { ...DEFAULT_PROFILE.mic, ...(s.mic ?? {}) },
    look: { ...DEFAULT_PROFILE.look, ...(s.look ?? {}) },
  };
}
