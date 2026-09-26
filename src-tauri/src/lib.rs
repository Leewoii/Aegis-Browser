mod commands;
mod download;
mod injection;
mod navigation;
mod security;
mod terminal;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "windows")]
  {
    // Enable Widevine DRM and hardware acceleration for video streaming (Netflix, Crunchyroll, YouTube)
    // Keep GPU compositing enabled (disabling causes blank/skeleton on YouTube) and don't disable TrackingPrevention aggressively
    std::env::set_var(
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      "--enable-features=WidevineCdm,MediaFoundationPlayback,HardwareMediaKeyHandling,EncryptedMedia --autoplay-policy=no-user-gesture-required",
    );
  }

  let navigation_state = Arc::new(Mutex::new(navigation::NavigationMap::default()));
  let download_state = download::DownloadState::default();
  let terminal_state = terminal::TerminalState::default();

  tauri::Builder::default()
    .manage(navigation::NavigationState(Arc::clone(&navigation_state)))
    .manage(download_state)
    .manage(terminal_state)
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(navigation::aegis_navigation_plugin(
      navigation_state,
      injection::nav_interception_script(),
      injection::player_script(),
    ))
    .invoke_handler(tauri::generate_handler![
      commands::allow_navigation,
      commands::navigate_webview,
      commands::set_webview_muted,
      commands::eval_in_webview,
      commands::clear_profile_data,
      commands::debug_log,
      security::encrypt_secret,
      security::decrypt_secret,
      security::decrypt_db,
      security::encrypt_db,
      security::encrypt_db_and_remove_plain,
      security::db_encryption_status,
      security::profile_status,
      security::create_profile,
      security::verify_profile,
      download::start_download,
      download::cancel_download,
      download::pause_download,
      download::resume_download,
      download::get_download_dir,
      terminal::create_terminal,
      terminal::write_terminal,
      terminal::resize_terminal,
      terminal::close_terminal,
      terminal::execute_command
    ])
    .run(tauri::generate_context!())
    .expect("error while running Aegis");
}
