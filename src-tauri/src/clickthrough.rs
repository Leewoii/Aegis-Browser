//! Click-through overlay support for the floating lock screen (AuthGate).
//!
//! When the lock panel is shown, the window is fullscreen yet only the small
//! centered card should capture the mouse — clicks anywhere else must fall
//! through to whatever is beneath the window (desktop / other apps).
//!
//! A pure frontend solution cannot do this reliably: once
//! `set_ignore_cursor_events(true)` is active the webview stops receiving
//! mouse events, so a mouseenter/mouseleave toggle gets permanently stuck.
//! Instead the frontend reports the panel rectangle (in physical screen
//! pixels) and a lightweight background thread polls the OS cursor position
//! and flips cursor-event handling only when the inside/outside state
//! changes. Non-Windows builds compile to a no-op stub.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Clone, Copy, Default)]
pub(crate) struct Hotzone {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

impl Hotzone {
  fn contains(&self, px: f64, py: f64) -> bool {
    px >= self.x && px < self.x + self.width && py >= self.y && py < self.y + self.height
  }
}

pub struct ClickthroughState(pub Mutex<Option<Hotzone>>);

/// Register the interactive rectangle (physical screen pixels). Everything
/// outside of it becomes click-through while the lock screen is mounted.
#[tauri::command]
pub fn set_clickthrough_hotzone(
  state: State<'_, ClickthroughState>,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  if width <= 0.0 || height <= 0.0 {
    return Err("Hotzone must have a positive size".into());
  }
  *state.0.lock().map_err(|e| e.to_string())? = Some(Hotzone { x, y, width, height });
  Ok(())
}

/// Remove the hotzone and restore normal mouse handling (used on unlock).
#[tauri::command]
pub fn clear_clickthrough_hotzone<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, ClickthroughState>,
) -> Result<(), String> {
  *state.0.lock().map_err(|e| e.to_string())? = None;
  if let Some(window) = app.get_window("main") {
    // Best effort: never leave the main window click-through after unlock.
    let _ = window.set_ignore_cursor_events(false);
  }
  Ok(())
}

#[cfg(target_os = "windows")]
mod platform {
  #[repr(C)]
  struct Point {
    x: i32,
    y: i32,
  }

  #[link(name = "User32")]
  extern "system" {
    fn GetCursorPos(lp_point: *mut Point) -> i32;
  }

  pub fn cursor_position() -> Option<(f64, f64)> {
    let mut point = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok == 0 {
      None
    } else {
      Some((point.x as f64, point.y as f64))
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod platform {
  pub fn cursor_position() -> Option<(f64, f64)> {
    None
  }
}

/// Background loop: poll the cursor and toggle click-through on transitions.
/// Started once from `setup`; cheap (sleeps between polls, IPC-free).
pub fn spawn_clickthrough_watcher<R: Runtime>(app: AppHandle<R>) {
  std::thread::spawn(move || {
    let mut ignoring: Option<bool> = None;
    loop {
      let hotzone: Option<Hotzone> = match app.try_state::<ClickthroughState>() {
        Some(state) => match state.0.lock() {
          Ok(guard) => *guard,
          Err(_) => None,
        },
        None => None,
      };

      match hotzone {
        Some(zone) => {
          if let Some((px, py)) = platform::cursor_position() {
            let should_ignore = !zone.contains(px, py);
            if ignoring != Some(should_ignore) {
              if let Some(window) = app.get_window("main") {
                if window.set_ignore_cursor_events(should_ignore).is_ok() {
                  ignoring = Some(should_ignore);
                }
              }
            }
          }
          std::thread::sleep(std::time::Duration::from_millis(33));
        }
        None => {
          if ignoring != Some(false) {
            if let Some(window) = app.get_window("main") {
              if window.set_ignore_cursor_events(false).is_ok() {
                ignoring = Some(false);
              }
            }
          }
          std::thread::sleep(std::time::Duration::from_millis(250));
        }
      }
    }
  });
}
