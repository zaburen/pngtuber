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

## Roadmap (user-approved 2026-08-23; reshaped 2026-09-12; States/Poses reframe 2026-09-13)

M1 shell + port ✔ → M2a layer model ✔ + per-layer variants ✔ → M2b global input (`rdev` keyboard, `gilrs` gamepad on the **xinput** backend) ✔ + States/Poses UI ✔ (gamepad-verified 2026-09-13). Next: the **States / Poses / Props** build order in [docs/ux-spec.md](docs/ux-spec.md) — poses (button-press, hold) done; props next, then toggle, then simple/advanced views, then layered composition + timed animations. Then M4 motion + profiles → M5 release (CI builds). Check in with user after each.

Model: avatar = ordered layer stack (unchanged). UI presents it as **States** (idle/talking), **Poses** (alternate full looks = variants of the main voice layer + a hold binding), and **Props** (non-voice layers; step 2). `src/lib/poses.ts` is the tested translation from pose ops to variant/binding mutations. Simple/advanced split deferred until the feature surface is complete.

## Testing (agent-drivable)

- `npm test` — vitest on the framework-free core (state machine, fallbacks, mergeProfile migrations). `cargo test` reserved for Rust logic as it grows.
- Overlay: headless Chrome screenshot of `http://127.0.0.1:8737/` while the app runs.
- Panel UI: launch dev with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then drive the real webview over CDP (`http://127.0.0.1:9223/json` → WebSocket → Runtime.evaluate / Page.captureScreenshot). Clicks real elements, screenshots without stealing window focus.
- WS state: one-shot `new WebSocket('ws://127.0.0.1:8737/ws')` dump.
- Mic/speech: add Chromium fake-media flags to the same env var — `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>` — and getUserMedia serves that WAV (looped) as the mic. Generate speech-with-pauses via SAPI TTS (PowerShell System.Speech, SpeakSsml with `<break>`), then assert talk/idle transitions on the WS stream. Proven 2026-09-12.
- Input: global keyboard hooks receive SendInput-synthesized events — hotkeys testable end-to-end (arm capture in a pose card, synthesize a key, assert the WS state swaps `main.default` → `main.<pose>`). Gamepad is user-manual QA (`gilrs` needs the **xinput** feature, not the default wgi, or a connected pad isn't enumerated on Windows).

## Conventions

- Never commit user art. Placeholder art is drawn in code.
- Profile schema changes: bump nothing yet, extend `mergeProfile` so old files still load.
