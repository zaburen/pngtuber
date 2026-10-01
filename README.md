# pngtuber

Lightweight PNGTuber for streamers. Drop in your PNGs, talk into your mic, add one Browser source in OBS. Windows / macOS / Linux.

**Status: early development.** Motion and multiple profiles are on the roadmap.

## How it works

- Your mic volume switches between **idle** and **talking** frames; the avatar blinks on its own.
- The avatar is a stack of **layers** (body, hat, held controller…), each with swappable **variants**.
- **Bindings** map a keyboard key or gamepad button to a layer — show a variant, or show/hide the layer, while held or as a toggle. They work globally, so they fire while you're in your game.
- The app serves a transparent overlay page at `http://127.0.0.1:8737/`. Add it in OBS as a **Browser** source — real transparency, no chroma key.
- Keep the app running while you stream (it's what listens to the mic).

### Input privacy

Bindings use a global input hook (that's what makes them work while a game has focus), so here is exactly what it does: every key/button event is compared against the list of triggers you bound and **dropped unless it matches**. Unbound keystrokes are never stored, logged, or transmitted — there is no buffer to leak. The one exception is the moment you click a binding's trigger button: the very next key you press is forwarded once so the app can learn it. The code is short and auditable: [`src-tauri/src/input.rs`](src-tauri/src/input.rs).

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
| Backend | Rust (`src-tauri/`) | File storage, localhost server, global input hooks (rdev + gilrs) |
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
src/lib/            types.ts (Profile schema) · mic.ts · avatar.ts · bindings.ts · renderer.ts · backend.ts
src/routes/         +page.svelte (control panel) · overlay/+page.svelte (OBS page)
src-tauri/src/      lib.rs (Tauri commands) · server.rs (axum: /overlay, /frames/*, /ws) · input.rs (global input)
```

User data (never in the repo): `<app-data>/com.zcdor.pngtuber/profiles/default/` — `profile.json` + `frames/*.png`. The profile JSON is opaque to Rust; the frontend owns the schema and migrates old files via `mergeProfile()`.

## Contributing

Bug reports and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). In short: open an issue
first for bugs and features, branch off `main`, and link the issue from your PR.

## License

[GPL-3.0-or-later](LICENSE). Use the code freely — but any distributed product built on it must be open source under the same license.
