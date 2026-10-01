# Contributing

Thanks for your interest. This is a small project; the flow below keeps changes traceable without much ceremony.

## The flow

1. **Open an issue first** for a bug or a feature.
   - Bugs: include steps to reproduce. A change is much easier to accept when the problem is reproducible.
   - Features: say *what* it is, *why* it's needed, and what success looks like.
   - Chores, dependency bumps, docs, and typo fixes don't need an issue — a pull request is enough.
2. **Branch off `main`.** Direct pushes to `main` are blocked; every change lands via pull request.
3. **Open a pull request** and link the issue with `Closes #123` (or `Fixes #123`) so it closes on merge.
4. **Green checks merge it.** CI runs on Linux and Windows; CodeQL scans the code. All checks must pass.

## Before you push

- `npm run check` — svelte-check / TypeScript, clean.
- `npm test` — the framework-free core (state machine, migrations, layer ops).
- `cargo test` — if you touched Rust (`cd src-tauri`).
- Keep commits focused: one logical change each.
- Never commit user art or secrets. Placeholder art is drawn in code.

## Dev setup

See [Build from source](README.md#build-from-source) in the README. In short: Node 20+, Rust, and the
Tauri prerequisites for your OS, then `npm install` and `npm run tauri dev`.

## License

By contributing you agree your changes are licensed under [GPL-3.0-or-later](LICENSE), the project's license.
