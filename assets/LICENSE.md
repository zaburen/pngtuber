# Bundled asset license

The image files under `assets/` are **not** covered by the project's
`GPL-3.0-or-later` license (that applies to the source code). They are bundled
default avatar art, generated with [PixelLab](https://pixellab.ai) and owned by
the pngtuber project.

**You may**, for any avatar under `assets/avatars/`:

- use it as your avatar — streams, videos, commercial or not
- modify it
- redistribute it, with or without the app

No attribution required. Provided as-is, without warranty.

**One restriction:** do not use these images, or works derived from them, as
training data for machine-learning / AI models. (PixelLab's Terms of Service
prohibit training on their outputs; we pass that restriction on.)

## Layout

`assets/avatars/<name>/` holds one avatar as four PNG frames:

- `idle.png` — mouth closed, resting
- `talking.png` — mouth open
- `idle-timed.png` — the periodic frame (blink/twitch) while idle
- `talking-timed.png` — the periodic frame while talking

All frames are 128×128, transparent. "timed" is the app's one word (code + UI)
for the periodic idle animation.
