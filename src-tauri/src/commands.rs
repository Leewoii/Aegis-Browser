use tauri::{AppHandle, Manager, Runtime, State};
use std::fs::OpenOptions;
use std::io::Write;

use crate::navigation::NavigationState;

const ALLOWED_SCHEMES: [&str; 4] = ["http://", "https://", "file://", "data:"];

/// Whitelist a URL for a given webview label before the frontend triggers it.
#[tauri::command]
pub fn allow_navigation(state: State<'_, NavigationState>, label: String, url: String) -> Result<(), String> {
  if !ALLOWED_SCHEMES.iter().any(|scheme| url.starts_with(scheme)) {
    return Err(format!(
      "Navigation blocked: invalid URL scheme for label '{}': {}",
      label, url
    ));
  }
  state.approve(&label, &url);
  Ok(())
}

/// Navigate an existing webview to a URL. Marks the label as frontend-initiated
/// so subsequent redirects are allowed for a short window.
#[tauri::command]
pub fn navigate_webview<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, NavigationState>,
  label: String,
  url: String,
) -> Result<(), String> {
  state.approve(&label, &url);
  println!("[Aegis-nav] NAVIGATE_PENDING label={} url={}", label, url);

  let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL '{}': {}", url, e))?;

  // Search standalone webview windows first, then child webviews of "main".
  for (_, window) in app.webview_windows() {
    if window.label() == label {
      return window
        .navigate(parsed)
        .map_err(|e| format!("Failed to navigate webview '{}': {}", label, e));
    }
  }

  if let Some(window) = app.get_window("main") {
    for child in window.webviews() {
      if child.label() == label {
        return child
          .navigate(parsed)
          .map_err(|e| format!("Failed to navigate child webview '{}': {}", label, e));
      }
    }
  }

  Err(format!("Webview '{}' not found", label))
}

/// Mute or unmute all media elements inside a panel webview.
#[tauri::command]
pub fn set_webview_muted<R: Runtime>(
  app: AppHandle<R>,
  label: String,
  muted: bool,
) -> Result<(), String> {
  let js = if muted {
    r#"(() => { document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.pause(); }); })();"#
  } else {
    r#"(() => { document.querySelectorAll('audio, video').forEach(el => { el.muted = false; }); })();"#
  };

  if let Some(window) = app.get_window("main") {
    for child in window.webviews() {
      if child.label() == label {
        return child
          .eval(js)
          .map_err(|e| format!("Failed to eval mute script in webview '{}': {}", label, e));
      }
    }
  }
  Err(format!("Webview '{}' not found for muting", label))
}

/// Evaluate arbitrary JS in a webview by label (used for extensions e.g. Netflix auto-skip)
#[tauri::command]
pub fn eval_in_webview<R: Runtime>(
  app: AppHandle<R>,
  label: String,
  script: String,
) -> Result<(), String> {
  // Search standalone webview windows first
  for (_, window) in app.webview_windows() {
    if window.label() == label {
      return window
        .eval(&script)
        .map_err(|e| format!("Failed to eval in webview '{}': {}", label, e));
    }
  }
  if let Some(window) = app.get_window("main") {
    for child in window.webviews() {
      if child.label() == label {
        return child
          .eval(&script)
          .map_err(|e| format!("Failed to eval in webview '{}': {}", label, e));
      }
    }
  }
  Err(format!("Webview '{}' not found for eval", label))
}

/// Clear profile directory data for a given workspace or panel profile.
#[tauri::command]
pub fn clear_profile_data<R: Runtime>(
  app: AppHandle<R>,
  profile_key: String,
) -> Result<(), String> {
  let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let profile_dir = app_data.join("profiles").join(&profile_key);
  if profile_dir.exists() {
    std::fs::remove_dir_all(&profile_dir)
      .map_err(|e| format!("Failed to clear profile directory '{}': {}", profile_key, e))?;
  }
  Ok(())
}

/// Persistent diagnostics sink (release-safe).
/// Only counts/ids/timestamps may be logged by callers — and as a second
/// line of defense any URL-looking substring is redacted here, since some
/// legacy call sites interpolate request URLs. Rotated at 512 KiB.
#[tauri::command]
pub fn debug_log(app: AppHandle, message: String) -> Result<(), String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let log_path = dir.join("aegis-diagnostics.log");
  if let Ok(meta) = std::fs::metadata(&log_path) {
    if meta.len() > 512 * 1024 {
      let _ = std::fs::remove_file(dir.join("aegis-diagnostics.log.old"));
      let _ = std::fs::rename(&log_path, dir.join("aegis-diagnostics.log.old"));
    }
  }

  let safe = redact_urls(&message);
  let mut file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&log_path)
    .map_err(|e| e.to_string())?;

  writeln!(file, "{}", safe).map_err(|e| e.to_string())?;
  Ok(())
}

fn redact_urls(message: &str) -> String {
  let bytes = message.as_bytes();
  let mut out = String::with_capacity(message.len());
  let mut i = 0;
  while i < bytes.len() {
    let rest = &message[i..];
    let marker = if rest.starts_with("https://") {
      Some(8)
    } else if rest.starts_with("http://") {
      Some(7)
    } else if rest.starts_with("url=") {
      Some(4)
    } else {
      None
    };
    if let Some(prefix) = marker {
      out.push_str(&message[i..i + prefix]);
      out.push_str("[redacted]");
      i += prefix;
      while i < bytes.len() {
        let c = bytes[i] as char;
        if c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ')' | ']' | '}') {
          break;
        }
        i += 1;
      }
    } else {
      // Advance by one UTF-8 char boundary.
      let mut len = 1;
      while !message.is_char_boundary(i + len) {
        len += 1;
      }
      out.push_str(&message[i..i + len]);
      i += len;
    }
  }
  out
}
