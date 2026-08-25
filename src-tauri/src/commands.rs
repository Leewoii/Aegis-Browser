use tauri::{AppHandle, Manager, Runtime, State};

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
  println!("[silentx-nav] NAVIGATE_PENDING label={} url={}", label, url);

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
