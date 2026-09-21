# pngtuber UX spec — Character + Layers (v1)

Status: v1 scope, 2026-09-21. Deliberately simple: a base character plus independent
on/off layers. Decisions are the user's; future ideas are parked at the bottom.

## Model

One data model (a layer stack). Two user-facing concepts:

### Character (the base)

One look, four frames:

- **idle** — not talking. Required.
- **talking** — talking. Falls back to idle.
- **idle-timed** — a periodic variant of idle, briefly shown on a timer (a blink, a
  twitch, hair sway — not everyone has eyes, so it's "timed", not "blink"). Optional.
- **talking-timed** — periodic variant of talking. Optional.

"timed" is the one word used in code AND UI (no synonyms). A **Timed frame** toggle +
a "how often" interval drive the periodic swap.

### Layers (everything else)

Independent overlays and backgrounds the user turns on/off: glasses, a pipe, a disco
ball, a background. Layers never fight each other — each is just on or off. Each layer has:

- one image,
- **on/off** (via the UI in v1),
- **z-order** — reorderable; can sit behind or in front of the character,
- **move with character** — bounces on talk with the character (on by default; off for
  backgrounds),
- **nudge (x/y)** — small offset so an accessory lines up on different-sized faces.

## v1 also includes

- **Bundled default avatars** — a few PixelLab-generated starters (skin tones, hairstyles)
  so people can use/test without making art first. (Confirm PixelLab redistribution terms
  before bundling — we looked into it before, expected fine.)

## Not in v1

- **Button / hotkey layer triggers.** The global input engine (rdev keyboard + gilrs
  gamepad) is built and tested; it stays on the branch, **unwired**, ready for 2.0.
- **Layer animations** (smoking pipe, etc.).
- **Poses / character-swap** (whole-look changes on a trigger), incl. the hold-a-controller
  idea — radar only, may never ship.
- **Build-your-own-avatar.**
- **Simple/advanced UI split** — not needed at this scope; one UI.

## UI

One panel, roughly as it is now:

- **Character:** idle / talking / idle-timed / talking-timed slots.
- **Layers:** each a card — image, on/off, z-order (▲▼ / behind-front), move-with-character,
  nudge. **+ Add layer.**
- Global: mic, look (scale / crisp pixels / bounce), Timed frame + interval, OBS URL, About.

## Data model mapping (no schema churn)

- Character = the main voice-reactive layer, single variant, four frames.
- A Layer = a non-voice layer (`reactsToVoice: false`) with one image, plus a per-layer
  `followBounce` flag and `offset {x,y}`.
- Deleting a layer/frame prompts for confirmation (no more silent art loss).
