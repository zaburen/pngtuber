// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 zaburen

//! Global input listeners: keyboard (rdev) and gamepad (gilrs).
//!
//! Privacy design — this is the keylogger-shaped part of the app, so it is
//! deliberately narrow: every event is matched against the set of triggers
//! the frontend has registered as bound and DROPPED unless it matches.
//! Unbound keystrokes are never buffered, logged, or forwarded. The single
//! exception is capture mode (`set_trigger_capture`), which the binding
//! editor turns on to learn the next key/button the user presses; it
//! forwards exactly one press and switches itself off.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct InputFilter {
    pub bound: HashSet<String>,
    pub capturing: bool,
}

pub type SharedFilter = Arc<Mutex<InputFilter>>;

#[derive(Clone, serde::Serialize)]
struct TriggerEvent {
    trigger: String,
    down: bool,
}

/// Route one input event: capture beats bound-match; everything else is dropped.
fn handle(app: &AppHandle, filter: &SharedFilter, trigger: String, down: bool) {
    let mut f = filter.lock().unwrap();
    if f.capturing {
        if down {
            f.capturing = false;
            drop(f);
            let _ = app.emit("input-capture", TriggerEvent { trigger, down });
        }
        return;
    }
    if f.bound.contains(&trigger) {
        drop(f);
        let _ = app.emit("input-trigger", TriggerEvent { trigger, down });
    }
}

/// Keyboard listener thread. rdev's Debug names are stable identifiers
/// ("KeyA", "F5", "ShiftLeft"); the frontend stores triggers as "key:<name>".
pub fn spawn_keyboard(app: AppHandle, filter: SharedFilter) {
    std::thread::spawn(move || {
        // OS auto-repeat re-sends KeyPress while held; track what is down so
        // hold-bindings see one down and one up.
        let mut pressed: HashSet<rdev::Key> = HashSet::new();
        let result = rdev::listen(move |event| match event.event_type {
            rdev::EventType::KeyPress(key) => {
                if pressed.insert(key) {
                    handle(&app, &filter, format!("key:{key:?}"), true);
                }
            }
            rdev::EventType::KeyRelease(key) => {
                if pressed.remove(&key) {
                    handle(&app, &filter, format!("key:{key:?}"), false);
                }
            }
            _ => {} // mouse events are not bindable
        });
        if let Err(e) = result {
            log::warn!("keyboard listener unavailable: {e:?}");
        }
    });
}

/// Gamepad poll thread. Button Debug names are stable ("South", "LeftTrigger");
/// triggers are stored as "pad:<name>".
pub fn spawn_gamepad(app: AppHandle, filter: SharedFilter) {
    std::thread::spawn(move || {
        let mut gilrs = match gilrs::Gilrs::new() {
            Ok(g) => g,
            Err(e) => {
                log::warn!("gamepad support unavailable: {e}");
                return;
            }
        };
        loop {
            while let Some(gilrs::Event { event, .. }) = gilrs.next_event() {
                match event {
                    gilrs::EventType::ButtonPressed(btn, _) => {
                        handle(&app, &filter, format!("pad:{btn:?}"), true);
                    }
                    gilrs::EventType::ButtonReleased(btn, _) => {
                        handle(&app, &filter, format!("pad:{btn:?}"), false);
                    }
                    _ => {} // axes/connection events are not bindable (yet)
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
    });
}
