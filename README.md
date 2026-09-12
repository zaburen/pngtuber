# pngtuber

Lightweight PNGTuber for streamers. Drop in your PNGs, talk into your mic, add one Browser source in OBS. Windows / macOS / Linux.

**Status: early development.** Hotkey/controller poses, layered parts, motion, and multiple profiles are on the roadmap.

## How it works

- Your mic volume switches between **idle** and **talking** frames; the avatar blinks on its own.
- The app serves a transparent overlay page at `http://127.0.0.1:8737/`. Add it in OBS as a **Browser** source — real transparency, no chroma key.
- Keep the app running while you stream (it's what listens to the mic).

## Setup

1. Download the release for your OS (or build from source, below) and run it.
2. Click the frame slots (or drag PNGs onto them): `idle` is required; `talking`, `idle-blink`, `talking-blink` are optional and fall back sensibly. Use the same canvas size for all frames.
3. Click **Start mic**, pick your microphone, tune **Threshold** so the meter only crosses the red line when you speak.
4. In OBS: Sources → + → Browser → URL `http://127.0.0.1:8737/`, size it to taste.

Your frames and settings live in the app data folder (**Open data folder** button). Back that up to keep your avatar.

## Build from source

Needs [Node 20+](https://nodejs.org) and [Rust](https://rustup.rs) (plus the usual [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS).

```sh
npm install
npm run tauri dev      # run
npm run tauri build    # installer in src-tauri/target/release/bundle/
```

## Architecture

Tauri app: a Rust binary hosts the OS's built-in webview (WebView2 / WebKit), which runs the UI. Rust compiles natively per platform — no Electron, no bundled browser.

| Layer | Tech | Role |
|---|---|---|
| UI | Svelte 5 + TypeScript (SvelteKit, static adapter) | Control panel + overlay page |
| Core logic | Plain TS (`src/lib/`) | Mic analysis, avatar state machine, renderer — framework-free, shared by panel and overlay |
| Backend | Rust (`src-tauri/`) | File storage, localhost server; input hooks planned |
| Bridge | Tauri `invoke()` | UI calls Rust commands, gets Promises back |

### Data flow

```
mic ──► avatar.ts (talking/blink state) ──► RenderState
                                              │
              ┌───────────────────────────────┴─────────────┐
              ▼                                             ▼
      in-app preview (renderer.ts)         Rust publish_state ──► ws://127.0.0.1:8737/ws
                                                            │
                                                            ▼
                                              OBS overlay page (renderer.ts)
```

The state machine lives in the frontend because the mic needs the webview's `AudioContext`. Rust stays a relay + file clerk: the axum server (`src-tauri/src/server.rs`) serves the overlay page (embedded at build time via rust-embed), the frame PNGs, and the WebSocket broadcast. The overlay is a browser source rather than a window capture because that's the only way OBS gets real alpha.

### Layout

```
src/lib/            types.ts (Profile schema) · mic.ts · avatar.ts · renderer.ts · backend.ts
src/routes/         +page.svelte (control panel) · overlay/+page.svelte (OBS page)
src-tauri/src/      lib.rs (Tauri commands) · server.rs (axum: /overlay, /frames/*, /ws)
```

User data (never in the repo): `<app-data>/com.zcdor.pngtuber/profiles/default/` — `profile.json` + `frames/*.png`. The profile JSON is opaque to Rust; the frontend owns the schema and migrates old files via `mergeProfile()`.

## License

[GPL-3.0-or-later](LICENSE). Use the code freely — but any distributed product built on it must be open source under the same license.
