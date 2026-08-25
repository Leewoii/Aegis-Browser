mod commands;
mod injection;
mod navigation;
mod security;

use std::sync::{Arc, Mutex};

use tauri_plugin_sql::{Migration, MigrationKind};

fn sql_migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create initial tables",
      sql: "
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tabs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          idx INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          visited_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS downloads (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          url TEXT NOT NULL,
          total_bytes REAL NOT NULL DEFAULT 0,
          received_bytes REAL NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      ",
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "structured workspaces, tab_groups, tabs_v2, sidebar, sessions, and secure vault",
      sql: "
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          color TEXT,
          idx INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tab_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT,
          collapsed INTEGER NOT NULL DEFAULT 0,
          workspace_id TEXT NOT NULL DEFAULT 'personal',
          idx INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tabs_v2 (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          idx INTEGER NOT NULL DEFAULT 0,
          workspace_id TEXT NOT NULL DEFAULT 'personal',
          group_id TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          muted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sidebar_state (
          key TEXT PRIMARY KEY,
          is_sidebar_pinned INTEGER NOT NULL DEFAULT 0,
          active_panel TEXT,
          is_panel_pinned INTEGER NOT NULL DEFAULT 0,
          panel_width INTEGER NOT NULL DEFAULT 340,
          muted_panels TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS session_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS closed_tabs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          tab_data TEXT NOT NULL,
          closed_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS secure_vault (
          key TEXT PRIMARY KEY,
          ciphertext TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS downloads_v2 (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          url TEXT NOT NULL,
          destination TEXT,
          total_bytes REAL NOT NULL DEFAULT 0,
          received_bytes REAL NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'completed',
          started_at INTEGER NOT NULL DEFAULT 0,
          completed_at INTEGER NOT NULL DEFAULT 0
        );
      ",
      kind: MigrationKind::Up,
    },
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let navigation_state = Arc::new(Mutex::new(navigation::NavigationMap::default()));

  tauri::Builder::default()
    .manage(navigation::NavigationState(Arc::clone(&navigation_state)))
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:silentx.db", sql_migrations())
        .build(),
    )
    .plugin(navigation::silentx_navigation_plugin(
      navigation_state,
      injection::interception_script(),
    ))
    .invoke_handler(tauri::generate_handler![
      commands::allow_navigation,
      commands::navigate_webview,
      commands::set_webview_muted,
      commands::clear_profile_data,
      security::encrypt_secret,
      security::decrypt_secret
    ])
    .run(tauri::generate_context!())
    .expect("error while running SilentX Browser");
}
