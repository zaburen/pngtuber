// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

//! Localhost HTTP + WebSocket server.
//!
//! Serves the OBS overlay page (the built SvelteKit `/overlay` route), the
//! current profile's frame images, and a `/ws` endpoint that rebroadcasts
//! whatever render state the control window publishes. OBS adds a Browser
//! Source pointing at `http://127.0.0.1:<port>/` and gets real transparency.

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, Request, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use rust_embed::RustEmbed;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;

pub const DEFAULT_PORT: u16 = 8737;

/// Built frontend (SvelteKit static output). Read from disk in debug builds,
/// embedded into the binary in release builds.
#[derive(RustEmbed)]
#[folder = "../build/"]
struct Frontend;

#[derive(Clone)]
pub struct Shared {
    /// Directory holding the active profile's `frames/` folder.
    pub profile_dir: Arc<RwLock<PathBuf>>,
    /// Latest render-state JSON, replayed to newly connected overlays.
    pub last_state: Arc<RwLock<Option<String>>>,
    pub tx: broadcast::Sender<String>,
}

impl Shared {
    pub fn new(profile_dir: PathBuf) -> Self {
        let (tx, _) = broadcast::channel(64);
        Self {
            profile_dir: Arc::new(RwLock::new(profile_dir)),
            last_state: Arc::new(RwLock::new(None)),
            tx,
        }
    }

    pub async fn publish(&self, json: String) {
        *self.last_state.write().await = Some(json.clone());
        // Error only means "no overlay connected" – not a failure.
        let _ = self.tx.send(json);
    }
}

pub async fn run(shared: Shared, port: u16) {
    let app = Router::new()
        .route("/", get(|| async { Redirect::temporary("/overlay") }))
        .route("/ws", get(ws_handler))
        .route("/frames/{name}", get(frame))
        .fallback(static_file)
        .layer(CorsLayer::permissive())
        .with_state(shared);

    let addr = format!("127.0.0.1:{port}");
    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            log::info!("overlay server listening on http://{addr}/");
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("overlay server stopped: {e}");
            }
        }
        Err(e) => log::error!("cannot bind overlay server on {addr}: {e}"),
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(shared): State<Shared>) -> Response {
    ws.on_upgrade(move |socket| ws_session(socket, shared))
}

async fn ws_session(mut socket: WebSocket, shared: Shared) {
    let mut rx = shared.tx.subscribe();
    if let Some(last) = shared.last_state.read().await.clone() {
        if socket.send(Message::Text(last.into())).await.is_err() {
            return;
        }
    }
    log::debug!("overlay connected");
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(json) => {
                    if socket.send(Message::Text(json.into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {} // overlays don't send anything we act on
            },
        }
    }
    log::debug!("overlay disconnected");
}

/// A safe frame filename: a single plain path segment ending in `.png`.
///
/// Rejects separators and `..`, but also — unlike a bare slash check — Windows
/// drive-relative names like `C:foo.png`, which `Path::join` resolves against
/// C:'s current directory (escaping the frames dir), and absolute paths.
fn frame_name_ok(name: &str) -> bool {
    if !name.ends_with(".png") {
        return false;
    }
    let mut comps = std::path::Path::new(name).components();
    matches!(
        (comps.next(), comps.next()),
        (Some(std::path::Component::Normal(_)), None)
    )
}

async fn frame(Path(name): Path<String>, State(shared): State<Shared>) -> Response {
    if !frame_name_ok(&name) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = shared.profile_dir.read().await.join("frames").join(&name);
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn static_file(req: Request<Body>) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    // SvelteKit static adapter emits `overlay.html` for `/overlay`.
    let candidates = [path.to_string(), format!("{path}.html"), format!("{path}/index.html")];
    for c in candidates {
        if let Some(file) = Frontend::get(&c) {
            let mime = mime_guess::from_path(&c).first_or_octet_stream();
            return ([(header::CONTENT_TYPE, mime.as_ref())], file.data.into_owned()).into_response();
        }
    }
    StatusCode::NOT_FOUND.into_response()
}

#[cfg(test)]
mod tests {
    use super::frame_name_ok;

    #[test]
    fn accepts_plain_png_names() {
        assert!(frame_name_ok("main.default.idle.png"));
        assert!(frame_name_ok("l7k2x9.default.talking-timed.png"));
    }

    #[test]
    fn rejects_non_png_and_separators_and_traversal() {
        assert!(!frame_name_ok("main.default.idle")); // no .png
        assert!(!frame_name_ok("evil.txt"));
        assert!(!frame_name_ok("a/b.png"));
        assert!(!frame_name_ok("a\\b.png"));
        assert!(!frame_name_ok("../secret.png"));
        assert!(!frame_name_ok(".."));
        assert!(!frame_name_ok("/etc/passwd.png")); // absolute
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_drive_relative() {
        // `<frames>.join("C:foo.png")` resolves against C:'s cwd, escaping frames.
        assert!(!frame_name_ok("C:foo.png"));
        assert!(!frame_name_ok("C:\\foo.png"));
    }
}
