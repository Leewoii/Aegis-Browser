mod commands;
mod injection;
mod navigation;
mod security;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let navigation_state = Arc::new(Mutex::new(navigation::NavigationMap::default()));

  tauri::Builder::default()
    .manage(navigation::NavigationState(Arc::clone(&navigation_state)))
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(navigation::aegis_navigation_plugin(
      navigation_state,
      injection::interception_script(),
    ))
    .invoke_handler(tauri::generate_handler![
      commands::allow_navigation,
      commands::navigate_webview,
      commands::set_webview_muted,
      commands::clear_profile_data,
      commands::debug_log,
      security::encrypt_secret,
      security::decrypt_secret
    ])
    .run(tauri::generate_context!())
    .expect("error while running Aegis Browser");
}
