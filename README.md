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

## License

MIT
