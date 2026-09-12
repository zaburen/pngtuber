// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

fn main() {
    // rust-embed needs the frontend output folder to exist at compile time,
    // even in debug builds where files are read lazily at runtime.
    std::fs::create_dir_all("../build").expect("create ../build");
    tauri_build::build()
}
