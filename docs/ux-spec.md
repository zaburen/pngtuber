# pngtuber UX spec — States / Poses / Props

Status: draft, 2026-09-13. Decisions are the user's; deferred items are explicitly parked.

## Vocabulary

- **States** — the core voice looks: **idle** and **talking**. Mandatory.
- **Poses** — alternate full looks that **inherit the States** (each implements idle +
  talking; blink optional). Trigger-activated; activating one swaps the whole avatar to
  that look, releasing reverts.
- **Props** — elements that **don't** inherit States: backgrounds, accessories. Shown
  always, or toggled / swapped by a trigger.

All three map onto the existing data model via a layer's `reactsToVoice` flag — this is a
UI reframe, not an engine change:

- A **Pose** = a variant of the main voice-reactive layer (`main.<variantId>.<frame>.png`);
  the base look is the `default` variant.
- A **Prop** = a non-voice layer (`reactsToVoice: false`) + variants.

### Which to use

- Changes the face / expression / pose → **Pose** (full look, simple path).
- Independent add-on that can coexist with others (hat + glasses + background) → **Prop**
  (compositing / overlay, advanced path).

The full-look vs. overlay tradeoff is also where the eventual simple/advanced line falls.

## Timed animations (blink, hair-flow) — layer-scoped, not pose-scoped

A timed animation describes a **part** moving (eyes blink, hair sways), so it belongs to a
**layer**, not to a Pose. It only looks pose-scoped in the flat single-layer case, which
is why making it inherit across Poses would explode the frame count. Built from layers,
one blink on the eyes/face layer is shared across every Pose for free.

Decision: **timed animations are built with layered composition (step 6).** Until then,
blink stays as it works today — optional per-look frames, fine for a simple avatar. No
separate per-pose timed system (it would be throwaway).

## Triggers

- **Button-press** — active while a bound key / gamepad button is **held**. *(In scope.)*
- **Timed** — activates on a timer; multiple cycle. *(Deferred — with layer animations.)*
- **Toggle** — parked: unresolved rule for multiple toggles active at once. Hold-only
  until designed.

## Build order

1. **Button-press Poses** (hold-only). Flagship: press a button → avatar swaps to a full
   look with its own idle/talking; release → base. *(Build now.)*
2. **Props** (backgrounds / accessories; show-always or toggle/swap).
3. **Toggle mode** (after the multi-toggle rule is decided).
4. **Simple vs. advanced views** (decide the line once the feature surface exists).
5. **Layered character composition** (body / hair / mustache / clothing via PixelLab;
   outfit presets) **+ timed layer animations** (shared blink, hair-flow). A Pose's look
   generalizes from one frame set to a composition of layer variants (the "sets" idea).

## In scope now: button-press Poses

Adding a Pose:
1. **+ Add pose** → trigger type **Button press** (timed disabled for now).
2. **Capture the trigger** — press the key or gamepad button (already working).
3. Fill the Pose's frame slots: **idle required**, talking/blink optional (fall back to
   idle, same rules as the base States).
4. Mode **hold only**.

Behavior:
- Button held → avatar shows that Pose; release → base States.
- Multi-press (hold): later-pressed Pose wins; reverts to the other on release. Good
  enough now; revisit with toggle.

## Mapping to the existing data model (no schema change)

- Pose = variant of the main voice-reactive layer; frames `main.<variantId>.<frame>.png`.
- Base = the `default` variant.
- Button-press Pose = that variant + binding `{trigger, layerId: main, action: variant,
  variantId, mode: hold}`. Proven working (hold → swap → release reverts; bindings are
  runtime overrides, never written to disk).

## UI structure

- **Base states:** Idle + Talking slots (+ blink) — the minimum avatar.
- **Poses list:** each Pose as a card — trigger, its frame slots, rename, delete.
- **+ Add pose.**
- Global: mic, look (scale / crisp / bounce), blink (+ frequency, new), OBS URL, About.
- Props get their own section when built (step 2).

## Code modularity (refactor alongside step 1)

`+page.svelte` is one ~450-line component; split before it grows:
- Components: `Preview`, `MicPanel`, `LookPanel`, `FrameSlots` (reused per pose/variant),
  `PoseCard`, `PosesPanel`, `ObsPanel`, `AboutPanel`.
- New `src/lib/poses.ts`: translate pose operations (add / remove / rename, set trigger,
  set frames) into layer-variant + binding mutations, so UI and unit tests share one
  tested path.
- Core (`avatar`, `bindings`, `mic`, `renderer`, `types`) stays framework-free as-is.

## Blink frequency (small addition this pass)

Single "how often you blink" slider mapping to a sensible interval range (replaces the
hardcoded 2–7 s in the blink scheduler).
