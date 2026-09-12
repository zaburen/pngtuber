# pngtuber

Public, cross-platform PNGTuber desktop app (Tauri 2 + SvelteKit/Svelte 5 + TS). Successor to the private `streaming-avatar` single-file app. Audience: any streamer, no terminal.

## Architecture

- `src/lib/` — framework-free core: `renderer.ts` (frame swapper, shared by preview + overlay), `mic.ts`, `avatar.ts` (state machine → `RenderState`), `backend.ts` (Tauri command wrappers), `types.ts` (Profile schema, `mergeProfile` for migrations).
- `src/routes/+page.svelte` — control panel. Owns the state machine; pushes every `RenderState` to Rust via `publish_state`.
- `src/routes/overlay/` — OBS page (prerendered to `build/overlay.html`), subscribes to `ws://127.0.0.1:8737/ws`, renders only.
- `src-tauri/src/server.rs` — axum on 127.0.0.1:8737: `/overlay` + assets (rust-embed of `../build`), `/frames/<key>.png`, `/ws` broadcast.
- `src-tauri/src/lib.rs` — commands; profile JSON is opaque to Rust (frontend owns schema). Data: `<appData>/profiles/default/{profile.json,frames/}`.

## Why

- State machine in frontend: mic needs WebView AudioContext; Rust stays a relay + file store. Input hooks (M2) will go Rust → tauri event → frontend.
- Overlay via localhost browser source = real alpha in OBS; window capture can't do alpha.
- `beforeDevCommand` runs `npm run build` first because rust-embed needs `build/` to exist (build.rs also creates it empty).

## Roadmap (user-approved 2026-08-23, reshaped 2026-09-12)

M1 shell + port ✔ → M2a layer model ✔ + per-layer variants ✔ (avatar = ordered layer stack; each layer holds named variants — alternative looks; frames stored as <layerId>.<variantId>.<frameKey>.png) → M2b global input + bindings (`rdev`, `gilrs`; binding = trigger → swap/show/hide layer; add About credit to UI) → M3 layer UX polish (reorder, offsets, static props) → M4 motion + profiles → M5 release (CI builds). Check in with user after each.

Design rule: one data model (layer stack), one UI that grows — the simple user has a 1-layer stack and never sees layer vocabulary. No simple/advanced mode split.

## Testing (agent-drivable)

- `npm test` — vitest on the framework-free core (state machine, fallbacks, mergeProfile migrations). `cargo test` reserved for Rust logic as it grows.
- Overlay: headless Chrome screenshot of `http://127.0.0.1:8737/` while the app runs.
- Panel UI: launch dev with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then drive the real webview over CDP (`http://127.0.0.1:9223/json` → WebSocket → Runtime.evaluate / Page.captureScreenshot). Clicks real elements, screenshots without stealing window focus.
- WS state: one-shot `new WebSocket('ws://127.0.0.1:8737/ws')` dump.
- M2b input: global keyboard hooks receive SendInput-synthesized events — hotkeys testable. Gamepad + real mic stay manual (user).

## Conventions

- Never commit user art. Placeholder art is drawn in code.
- Profile schema changes: bump nothing yet, extend `mergeProfile` so old files still load.
