use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  webview::PageLoadEvent,
  Emitter,
  Wry,
};

const FRONTEND_NAV_WINDOW: Duration = Duration::from_secs(5);
const EMIT_DEBOUNCE: Duration = Duration::from_millis(1500);

/// Redact sensitive query parameters (such as tokens, passwords, secrets) from URLs for logging.
fn redact_url(raw: &str) -> String {
  if let Ok(mut parsed) = url::Url::parse(raw) {
    if parsed.query().is_some() {
      let sensitive_keys = [
        "token", "access_token", "refresh_token", "auth", "password", "pass", "pwd", "key",
        "secret", "api_key", "code", "session", "id_token",
      ];
      let mut pairs = Vec::new();
      for (k, v) in parsed.query_pairs() {
        let lower = k.to_lowercase();
        if sensitive_keys.iter().any(|&sk| lower.contains(sk)) {
          pairs.push((k.to_string(), "[REDACTED]".to_string()));
        } else {
          pairs.push((k.to_string(), v.to_string()));
        }
      }
      parsed.query_pairs_mut().clear().extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
      return parsed.to_string();
    }
  }
  raw.to_string()
}

/// True when two URLs resolve to the same host (ignoring the `www.` prefix).
/// Unparseable URLs fall back to exact string comparison.
fn urls_share_host(a: &str, b: &str) -> bool {
  let normalize_host = |value: &str| -> Option<String> {
    url::Url::parse(value)
      .ok()?
      .host_str()
      .map(|h| h.to_lowercase().trim_start_matches("www.").to_string())
  };
  match (normalize_host(a), normalize_host(b)) {
    (Some(host_a), Some(host_b)) => host_a == host_b,
    _ => a == b,
  }
}

#[derive(Default)]
pub struct NavigationMap {
  pub(crate) current_urls: HashMap<String, String>,
  pub(crate) recent_emits: HashMap<String, Instant>,
  pub(crate) pending_frontend_nav: HashMap<String, Instant>,
}

#[derive(Clone)]
pub struct NavigationState(pub Arc<Mutex<NavigationMap>>);

impl NavigationState {
  pub fn lock(&self) -> std::sync::MutexGuard<'_, NavigationMap> {
    self.0.lock().expect("navigation state poisoned")
  }

  /// Register a frontend-approved navigation target for a webview label.
  pub fn approve(&self, label: &str, url: &str) {
    let mut nav = self.lock();
    nav.current_urls.insert(label.to_string(), url.to_string());
    nav.pending_frontend_nav.insert(label.to_string(), Instant::now());
    println!("[Aegis-nav] ALLOW_REGISTER label={} url={}", label, redact_url(url));
  }
}

/// Build the `Aegis-navigation` plugin that gates navigation for child
/// webviews and forwards intercepted links to the main window.
pub fn aegis_navigation_plugin(
  state: Arc<Mutex<NavigationMap>>,
  interception_script: &'static str,
) -> TauriPlugin<Wry> {
  let state_for_nav = NavigationState(state.clone());

  PluginBuilder::<Wry, ()>::new("Aegis-navigation")
    .on_navigation(move |window, url| {
      let url_string = url.as_str().to_string();
      let label = window.label().to_string();

      // The main UI webview is always free to navigate.
      if label == "main" {
        return true;
      }

      // Internal click/activity notification from child tab webviews
      if url_string.starts_with("sx-internal://user-click") {
        if label.starts_with("Aegis-tab-") {
          let _ = window.emit_to("main", "Aegis-tab-pointerdown", &label);
        }
        return false;
      }

      // Explicit "Open in new tab" request from child webview (Ctrl+Click, Middle-Click, Context Menu, target="_blank", window.open)
      if url_string.starts_with("sx-internal://open-new-tab") {
        if let Ok(parsed) = url::Url::parse(&url_string) {
          for (k, v) in parsed.query_pairs() {
            if k == "url" && !v.is_empty() {
              println!("[Aegis-nav] EXPLICIT_OPEN_NEW_TAB label={} url={}", label, redact_url(&v));
              let _ = window.emit_to("main", "Aegis-open-link", &v.to_string());
              break;
            }
          }
        }
        return false;
      }

      // Keyboard shortcut forwarded from child webview (Ctrl+W, Ctrl+T, Ctrl+Tab, Ctrl+R, Ctrl+L)
      if url_string.starts_with("sx-internal://shortcut") {
        if let Ok(parsed) = url::Url::parse(&url_string) {
          for (k, v) in parsed.query_pairs() {
            if k == "action" && !v.is_empty() {
              println!("[Aegis-nav] SHORTCUT label={} action={}", label, v);
              let _ = window.emit_to("main", "Aegis-shortcut", &v.to_string());
              break;
            }
          }
        }
        return false;
      }

      let mut nav = state_for_nav.lock();

      // Allow redirects shortly after a frontend-initiated navigation.
      if let Some(since) = nav.pending_frontend_nav.get(&label).copied() {
        if since.elapsed() < FRONTEND_NAV_WINDOW {
          nav.current_urls.insert(label.clone(), url_string.clone());
          // Refresh timer so multi-hop redirect chains (e.g. notion.so -> www.notion.so -> notion.com) are allowed
          nav.pending_frontend_nav.insert(label.clone(), Instant::now());
          println!("[Aegis-nav] ALLOW_REDIRECT label={} url={}", label, redact_url(&url_string));
          return true;
        }
        nav.pending_frontend_nav.remove(&label);
      }

      if nav.current_urls.get(&label).is_some_and(|current| current == &url_string) {
        println!("[Aegis-nav] ALLOW label={} url={}", label, redact_url(&url_string));
        return true;
      }

      // Same-host navigations are genuine in-site movement (link clicks,
      // SPA routing, tracking-param redirects) — allow them in place.
      // Only cross-origin navigations get promoted to a new tab.
      if nav
        .current_urls
        .get(&label)
        .is_some_and(|current| urls_share_host(current, &url_string))
      {
        nav.current_urls.insert(label.clone(), url_string.clone());
        // Refresh timer for subsequent redirects
        nav.pending_frontend_nav.insert(label.clone(), Instant::now());
        println!("[Aegis-nav] ALLOW_SAME_HOST label={} url={}", label, redact_url(&url_string));
        return true;
      }

      // Debounce repeated emits for the same URL.
      let should_emit = nav
        .recent_emits
        .get(&url_string)
        .map_or(true, |emitted_at| emitted_at.elapsed() >= EMIT_DEBOUNCE);

      if should_emit {
        nav.recent_emits.insert(url_string.clone(), Instant::now());
        println!("[Aegis-nav] INTERCEPT label={} url={}", label, redact_url(&url_string));
        let _ = window.emit_to("main", "Aegis-open-link", &url_string);
      } else {
        println!("[Aegis-nav] DEBOUNCE label={} url={}", label, redact_url(&url_string));
      }

      false
    })
    .on_page_load(move |webview, payload| {
      let label = webview.label().to_string();
      let url = payload.url().to_string();

      match payload.event() {
        PageLoadEvent::Started => {
          println!("[Aegis-nav] PAGE_LOAD_STARTED label={} url={}", label, redact_url(&url));
          let _ = webview.emit_to("main", "Aegis-page-load-started", &url);

          if label.starts_with("Aegis-tab-") || label.starts_with("Aegis-panel-") {
            let _ = webview.eval(interception_script);
          }
        }
        PageLoadEvent::Finished => {
          let mut nav = state.lock().expect("navigation state poisoned");
          nav.current_urls.insert(label.clone(), url.clone());
          nav.recent_emits.remove(&url);
          println!("[Aegis-nav] PAGE_LOADED label={} url={}", label, redact_url(&url));
          let _ = webview.emit_to("main", "Aegis-page-load-finished", serde_json::json!({
            "label": label,
            "url": url,
          }));

          if label.starts_with("Aegis-tab-") || label.starts_with("Aegis-panel-") {
            let _ = webview.eval(interception_script);
          }
        }
      }
    })
    .build()
}
