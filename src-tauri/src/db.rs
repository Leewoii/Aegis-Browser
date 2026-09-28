//! SQLCipher-backed SQLite storage.
//!
//! The database file (including -wal/-shm journals) is ALWAYS ciphertext.
//! There is no decrypt-to-plaintext step: the key is applied with
//! `PRAGMA key` as the first statement on every open, directly from the
//! unlock password held in memory. Legacy plaintext / .enc stores are
//! migrated once (Phase 2) and their remnants secure-deleted.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde_json::{Map as JsonMap, Value as JsonValue};
use tauri::{AppHandle, Manager, State};

const DB_FILENAME: &str = "Aegis.db";

pub struct DbState(pub Arc<Mutex<Option<Connection>>>);

impl Default for DbState {
  fn default() -> Self {
    Self(Arc::new(Mutex::new(None)))
  }
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(
    app
      .path()
      .app_data_dir()
      .map_err(|e| e.to_string())?
      .join(DB_FILENAME),
  )
}

fn escape_sqlite_string(s: &str) -> String {
  s.replace('\'', "''")
}

/// Bound-parameter key application: arbitrary passwords are safe (no SQL
/// interpolation). Must run before any other statement on the connection.
fn apply_key(conn: &Connection, password: &str) -> Result<(), String> {
  conn
    .pragma_update(None, "key", &password.to_string())
    .map_err(|e| e.to_string())?;
  // Wrong key surfaces here ("file is not a database"), not on first table access.
  let _: i64 = conn
    .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
    .map_err(|e| format!("Open database: {e}"))?;
  Ok(())
}

fn tune(conn: &Connection) -> Result<(), String> {
  conn
    .pragma_update(None, "journal_mode", "WAL")
    .map_err(|e| e.to_string())?;
  conn
    .busy_timeout(std::time::Duration::from_millis(5000))
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[derive(PartialEq, Eq, Debug)]
enum FileKind {
  MissingOrEmpty,
  Plaintext,
  EncryptedOrUnknown,
}

fn file_kind(path: &Path) -> FileKind {
  let bytes = match std::fs::read(path) {
    Ok(b) => b,
    Err(_) => return FileKind::MissingOrEmpty,
  };
  if bytes.is_empty() {
    return FileKind::MissingOrEmpty;
  }
  if bytes.starts_with(b"SQLite format 3\0") {
    FileKind::Plaintext
  } else {
    FileKind::EncryptedOrUnknown
  }
}

/// Overwrite-then-remove so forensic recovery of the old plaintext fails.
fn secure_delete(path: &Path) {
  if let Ok(meta) = std::fs::metadata(path) {
    let len = meta.len();
    if len > 0 && len < 512 * 1024 * 1024 {
      if let Ok(f) = std::fs::OpenOptions::new().write(true).open(path) {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = f;
        let zeros = vec![0u8; 64 * 1024];
        let _ = file.seek(SeekFrom::Start(0));
        let mut remaining = len;
        while remaining > 0 {
          let n = std::cmp::min(remaining, zeros.len() as u64) as usize;
          if file.write_all(&zeros[..n]).is_err() {
            break;
          }
          remaining -= n as u64;
        }
        let _ = file.sync_all();
      }
    }
  }
  let _ = std::fs::remove_file(path);
}

fn journal_siblings(path: &Path) -> Vec<PathBuf> {
  let base = path.to_string_lossy().to_string();
  ["-wal", "-shm", "-journal", ".tmp"]
    .iter()
    .map(|s| PathBuf::from(format!("{base}{s}")))
    .collect()
}

/// One-way migration: legacy plaintext -> fresh SQLCipher database.
/// Verifies per-table row counts before replacing anything.
fn migrate_plaintext_to_encrypted(plain_path: &Path, password: &str) -> Result<(), String> {
  let new_path = PathBuf::from(format!(
    "{}.new",
    plain_path.to_string_lossy()
  ));
  if new_path.exists() {
    secure_delete(&new_path);
  }

  let plain = Connection::open(plain_path).map_err(|e| format!("Open legacy db: {e}"))?;
  let _ = plain.pragma_update(None, "journal_mode", "DELETE");

  let attach_sql = format!(
    "ATTACH DATABASE '{}' AS enc KEY '{}'",
    escape_sqlite_string(&new_path.to_string_lossy()),
    escape_sqlite_string(password),
  );
  plain
    .execute_batch(&attach_sql)
    .map_err(|e| format!("Attach encrypted db: {e}"))?;
  plain
    .execute_batch("SELECT sqlcipher_export('enc');")
    .map_err(|e| format!("Export to encrypted db: {e}"))?;

  // Verify: every source table must exist in the target with equal row counts.
  let tables: Vec<String> = {
    let mut stmt = plain
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
      out.push(row.get::<_, String>(0).map_err(|e| e.to_string())?);
    }
    out
  };
  for table in &tables {
    let src_count: i64 = plain
      .query_row(
        &format!("SELECT count(*) FROM \"{}\"", table.replace('"', "\"\"")),
        [],
        |row| row.get(0),
      )
      .map_err(|e| format!("Count {table} in legacy db: {e}"))?;
    let dst_count: i64 = plain
      .query_row(
        &format!("SELECT count(*) FROM enc.\"{}\"", table.replace('"', "\"\"")),
        [],
        |row| row.get(0),
      )
      .map_err(|e| format!("Count {table} in encrypted db: {e}"))?;
    if src_count != dst_count {
      return Err(format!(
        "Migration verification failed for {table}: {src_count} != {dst_count}"
      ));
    }
  }
  let _: String = plain
    .query_row("PRAGMA enc.integrity_check", [], |row| row.get(0))
    .map_err(|e| format!("Integrity check: {e}"))?;

  plain
    .execute_batch("DETACH DATABASE enc;")
    .map_err(|e| e.to_string())?;
  drop(plain);

  // Replace + destroy all plaintext remnants (db, journals, stale mirrors).
  secure_delete(plain_path);
  for sibling in journal_siblings(plain_path) {
    secure_delete(&sibling);
  }
  let dir = plain_path.parent().ok_or("Invalid db path")?;
  secure_delete(&dir.join("Aegis.db.enc"));
  secure_delete(&dir.join("Aegis.db.enc.tmp"));
  std::fs::rename(&new_path, plain_path).map_err(|e| format!("Commit migrated db: {e}"))?;
  Ok(())
}

fn open_inner(app: &AppHandle, password: &str) -> Result<Connection, String> {
  let path = db_path(app)?;
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  match file_kind(&path) {
    FileKind::Plaintext => {
      migrate_plaintext_to_encrypted(&path, password)?;
    }
    FileKind::MissingOrEmpty => {
      // Legacy DPAPI mirror only (no plaintext left behind)? Restore via the
      // existing path first, then migrate it like any other plaintext store.
      let enc_path = path.with_extension("db.enc");
      let enc_exists = enc_path.exists()
        || path
          .parent()
          .map(|d| d.join("Aegis.db.enc").exists())
          .unwrap_or(false);
      if enc_exists {
        let restored = crate::security::decrypt_db(app.clone(), password.to_string())?;
        if restored {
          migrate_plaintext_to_encrypted(&path, password)?;
        }
      }
    }
    FileKind::EncryptedOrUnknown => {}
  }

  let conn = Connection::open(&path).map_err(|e| format!("Open database file: {e}"))?;
  apply_key(&conn, password)?;
  tune(&conn)?;
  Ok(conn)
}

fn json_to_sql(value: &JsonValue) -> Result<SqlValue, String> {
  Ok(match value {
    JsonValue::Null => SqlValue::Null,
    JsonValue::Bool(b) => SqlValue::Integer(i64::from(*b)),
    JsonValue::Number(n) => {
      if let Some(i) = n.as_i64() {
        SqlValue::Integer(i)
      } else if let Some(u) = n.as_u64() {
        i64::try_from(u)
          .map(SqlValue::Integer)
          .map_err(|_| "Integer out of range".to_string())?
      } else if let Some(f) = n.as_f64() {
        SqlValue::Real(f)
      } else {
        return Err("Unsupported number".to_string());
      }
    }
    JsonValue::String(s) => SqlValue::Text(s.clone()),
    JsonValue::Array(_) | JsonValue::Object(_) => SqlValue::Text(value.to_string()),
  })
}

fn sql_to_json(value: SqlValue) -> JsonValue {
  match value {
    SqlValue::Null => JsonValue::Null,
    SqlValue::Integer(i) => JsonValue::from(i),
    SqlValue::Real(f) => JsonValue::from(f),
    SqlValue::Text(s) => JsonValue::from(s),
    SqlValue::Blob(b) => JsonValue::from(b.iter().map(|x| format!("{x:02x}")).collect::<String>()),
  }
}

/// Open (creating + migrating as needed) with the unlock password.
/// Idempotent: returns immediately if already open.
#[tauri::command]
pub async fn db_open(app: AppHandle, state: State<'_, DbState>, password: String) -> Result<(), String> {
  let arc = Arc::clone(&state.0);
  tokio::task::spawn_blocking(move || {
    {
      let guard = arc.lock().map_err(|e| e.to_string())?;
      if guard.is_some() {
        return Ok(());
      }
    }
    let conn = open_inner(&app, &password)?;
    *arc.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Explicit close with a final WAL checkpoint so -wal stays small.
#[tauri::command]
pub async fn db_close(state: State<'_, DbState>) -> Result<bool, String> {
  let arc = Arc::clone(&state.0);
  tokio::task::spawn_blocking(move || {
    let conn = arc.lock().map_err(|e| e.to_string())?.take();
    if let Some(conn) = conn {
      let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
      drop(conn);
      Ok(true)
    } else {
      Ok(false)
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_execute(
  state: State<'_, DbState>,
  sql: String,
  params: Vec<JsonValue>,
) -> Result<u64, String> {
  let arc = Arc::clone(&state.0);
  tokio::task::spawn_blocking(move || {
    let guard = arc.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database is not open")?;
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
    let refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let changed = conn
      .execute(&sql, params_from_iter(refs))
      .map_err(|e| e.to_string())?;
    Ok(changed as u64)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_query(
  state: State<'_, DbState>,
  sql: String,
  params: Vec<JsonValue>,
) -> Result<Vec<JsonValue>, String> {
  let arc = Arc::clone(&state.0);
  tokio::task::spawn_blocking(move || {
    let guard = arc.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database is not open")?;
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
    let refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(refs)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
      let mut obj = JsonMap::with_capacity(names.len());
      for (i, name) in names.iter().enumerate() {
        let value: SqlValue = row.get(i).map_err(|e| e.to_string())?;
        obj.insert(name.clone(), sql_to_json(value));
      }
      out.push(JsonValue::Object(obj));
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Inspect on-disk state without opening: { encrypted, legacy_plaintext, legacy_enc, missing }.
#[tauri::command]
pub fn db_status(app: AppHandle) -> Result<String, String> {
  let path = db_path(&app)?;
  let dir = path.parent().ok_or("Invalid db path")?;
  let kind = match file_kind(&path) {
    FileKind::MissingOrEmpty => "missing",
    FileKind::Plaintext => "legacy_plaintext",
    FileKind::EncryptedOrUnknown => "encrypted",
  };
  let has_enc = dir.join("Aegis.db.enc").exists();
  Ok(format!("store:{kind} enc_mirror:{has_enc} dir:{}", dir.to_string_lossy()))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("aegis-sqlcipher-spike-{tag}-{}.db", std::process::id()))
  }

  fn cleanup(path: &Path) {
    for p in std::iter::once(path.to_path_buf()).chain(journal_siblings(path)) {
      let _ = std::fs::remove_file(p);
    }
  }

  #[test]
  fn encrypted_roundtrip_and_header_is_ciphertext() {
    let path = temp_path("roundtrip");
    cleanup(&path);
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, "correct horse").unwrap();
      tune(&conn).unwrap();
      conn.execute_batch("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT); INSERT INTO t VALUES ('a','secret-value');").unwrap();
    }
    // File must NOT look like SQLite.
    let header = std::fs::read(&path).unwrap();
    assert!(!header.starts_with(b"SQLite format 3\0"), "db file is plaintext!");
    // Wrong key must fail.
    {
      let conn = Connection::open(&path).unwrap();
      assert!(apply_key(&conn, "wrong password").is_err(), "wrong key opened the db");
    }
    // Right key reads data back.
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, "correct horse").unwrap();
      let v: String = conn.query_row("SELECT v FROM t WHERE id='a'", [], |r| r.get(0)).unwrap();
      assert_eq!(v, "secret-value");
    }
    cleanup(&path);
  }

  #[test]
  fn quoting_passwords_with_quotes_work() {
    let path = temp_path("quotes");
    cleanup(&path);
    let tricky = "o'brien\"; DROP TABLE t; --";
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, tricky).unwrap();
      conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('x');").unwrap();
    }
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, tricky).unwrap();
      let n: i64 = conn.query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
      assert_eq!(n, 1);
    }
    cleanup(&path);
  }

  #[test]
  fn wal_mode_active_under_cipher() {
    let path = temp_path("wal");
    cleanup(&path);
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, "pw").unwrap();
      tune(&conn).unwrap();
      let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
      assert_eq!(mode.to_lowercase(), "wal");
      conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('wal-secret-xyz');").unwrap();
      // Force frames into the WAL without checkpointing everything away.
      conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);").unwrap();
    }
    // WAL file itself must be ciphertext too (no cleartext leak).
    let wal = PathBuf::from(format!("{}.wal", path.to_string_lossy()));
    if wal.exists() {
      let bytes = std::fs::read(&wal).unwrap();
      if !bytes.is_empty() {
        let needle = b"wal-secret-xyz";
        assert!(!bytes.windows(needle.len()).any(|w| w == needle), "WAL contains cleartext!");
      }
    }
    // Data still reads back fine.
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, "pw").unwrap();
      let v: String = conn.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
      assert_eq!(v, "wal-secret-xyz");
    }
    cleanup(&path);
  }

  #[test]
  fn plaintext_migration_preserves_rows() {
    let path = temp_path("migrate");
    cleanup(&path);
    {
      let plain = Connection::open(&path).unwrap();
      plain.execute_batch("CREATE TABLE tabs_v2 (id TEXT PRIMARY KEY, title TEXT); INSERT INTO tabs_v2 VALUES ('1','Tab One'),('2','Tab Two'); CREATE TABLE workspaces (id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('personal');").unwrap();
    }
    assert_eq!(file_kind(&path), FileKind::Plaintext);
    migrate_plaintext_to_encrypted(&path, "new-pass").unwrap();
    // Plaintext remnants gone, file is now ciphertext.
    assert_eq!(file_kind(&path), FileKind::EncryptedOrUnknown);
    {
      let conn = Connection::open(&path).unwrap();
      apply_key(&conn, "new-pass").unwrap();
      let n: i64 = conn.query_row("SELECT count(*) FROM tabs_v2", [], |r| r.get(0)).unwrap();
      assert_eq!(n, 2);
      let n: i64 = conn.query_row("SELECT count(*) FROM workspaces", [], |r| r.get(0)).unwrap();
      assert_eq!(n, 1);
    }
    // No cleartext of migrated titles anywhere in the file.
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.windows(7).any(|w| w == b"Tab One"));
    cleanup(&path);
  }
}

#[cfg(test)]
mod app_sql_compat_tests {
  use super::*;
  use serde_json::json;

  fn temp_path2(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("aegis-compat-{tag}-{}.db", std::process::id()))
  }

  #[test]
  fn save_tabs_statement_shape_works() {
    let path = temp_path2("savetabs");
    let _ = std::fs::remove_file(&path);
    let conn = Connection::open(&path).unwrap();
    apply_key(&conn, "pw").unwrap();
    tune(&conn).unwrap();
    conn.execute_batch("CREATE TABLE tabs_v2 (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', label TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]', idx INTEGER NOT NULL DEFAULT 0, workspace_id TEXT NOT NULL DEFAULT 'personal', group_id TEXT, pinned INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER NOT NULL DEFAULT 0); CREATE TABLE session_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);").unwrap();

    // EXACT shape of insertTab (13 positional $N params, mixed types incl. null)
    let insert = "INSERT OR REPLACE INTO tabs_v2 (id, kind, title, url, label, history, idx, workspace_id, group_id, pinned, muted, created_at, last_accessed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)";
    let p: Vec<JsonValue> = vec![json!("yt1"), json!("web"), json!("YouTube"), json!("https://www.youtube.com"), json!("Aegis-tab-yt1"), json!("[\"https://www.youtube.com\"]"), json!(0), json!("personal"), JsonValue::Null, json!(0), json!(0), json!(123), json!(456)];
    let sql_params: Vec<SqlValue> = p.iter().map(json_to_sql).collect::<Result<_, _>>().unwrap();
    let refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let n = conn.execute(insert, params_from_iter(refs)).unwrap();
    assert_eq!(n, 1);

    // EXACT shape of the NOT IN cleanup (dynamic placeholder list)
    let ids = vec!["yt1".to_string()];
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("${}", i + 1)).collect();
    let del = format!("DELETE FROM tabs_v2 WHERE id NOT IN ({})", placeholders.join(", "));
    let p2: Vec<JsonValue> = ids.into_iter().map(JsonValue::from).collect();
    let sql_params2: Vec<SqlValue> = p2.iter().map(json_to_sql).collect::<Result<_, _>>().unwrap();
    let refs2: Vec<&dyn rusqlite::ToSql> = sql_params2.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let n2 = conn.execute(&del, params_from_iter(refs2)).unwrap();
    assert_eq!(n2, 0);

    // read-back shape with column names
    let mut stmt = conn.prepare("SELECT id, title FROM tabs_v2 ORDER BY idx ASC").unwrap();
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    assert_eq!(names, vec!["id".to_string(), "title".to_string()]);
    let _ = std::fs::remove_file(&path);
  }
}
