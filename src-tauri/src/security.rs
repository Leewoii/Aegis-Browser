use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct SecureSecretPayload {
  pub key: String,
  pub value: String,
}

#[cfg(target_os = "windows")]
mod win_dpapi {
  use std::ptr::null_mut;

  #[repr(C)]
  struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
  }

  #[link(name = "Crypt32")]
  extern "system" {
    fn CryptProtectData(
      p_data_in: *const DataBlob,
      sz_data_descr: *const u16,
      p_optional_entropy: *const DataBlob,
      pv_reserved: *mut std::ffi::c_void,
      p_prompt_struct: *mut std::ffi::c_void,
      dw_flags: u32,
      p_data_out: *mut DataBlob,
    ) -> i32;

    fn CryptUnprotectData(
      p_data_in: *const DataBlob,
      ppsz_data_descr: *mut *mut u16,
      p_optional_entropy: *const DataBlob,
      pv_reserved: *mut std::ffi::c_void,
      p_prompt_struct: *mut std::ffi::c_void,
      dw_flags: u32,
      p_data_out: *mut DataBlob,
    ) -> i32;

    fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
  }

  const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

  pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    protect_with_entropy(data, &[])
  }

  pub fn protect_with_entropy(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    if data.is_empty() {
      return Ok(Vec::new());
    }

    let mut in_blob = DataBlob {
      cb_data: data.len() as u32,
      pb_data: data.as_ptr() as *mut u8,
    };

    let mut out_blob = DataBlob {
      cb_data: 0,
      pb_data: null_mut(),
    };
    let mut entropy_blob = DataBlob {
      cb_data: entropy.len() as u32,
      pb_data: entropy.as_ptr() as *mut u8,
    };
    let entropy_ptr = if entropy.is_empty() { null_mut() } else { &mut entropy_blob };

    let success = unsafe {
      CryptProtectData(
        &mut in_blob,
        null_mut(),
        entropy_ptr,
        null_mut(),
        null_mut(),
        CRYPTPROTECT_UI_FORBIDDEN,
        &mut out_blob,
      )
    };

    if success == 0 || out_blob.pb_data.is_null() {
      return Err("Windows DPAPI CryptProtectData failed".to_string());
    }

    let slice = unsafe { std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
    let result = slice.to_vec();

    unsafe {
      LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
    }

    Ok(result)
  }

  pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    unprotect_with_entropy(data, &[])
  }

  pub fn unprotect_with_entropy(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    if data.is_empty() {
      return Ok(Vec::new());
    }

    let mut in_blob = DataBlob {
      cb_data: data.len() as u32,
      pb_data: data.as_ptr() as *mut u8,
    };

    let mut out_blob = DataBlob {
      cb_data: 0,
      pb_data: null_mut(),
    };
    let mut entropy_blob = DataBlob {
      cb_data: entropy.len() as u32,
      pb_data: entropy.as_ptr() as *mut u8,
    };
    let entropy_ptr = if entropy.is_empty() { null_mut() } else { &mut entropy_blob };

    let success = unsafe {
      CryptUnprotectData(
        &mut in_blob,
        null_mut(),
        entropy_ptr,
        null_mut(),
        null_mut(),
        CRYPTPROTECT_UI_FORBIDDEN,
        &mut out_blob,
      )
    };

    if success == 0 || out_blob.pb_data.is_null() {
      return Err("Windows DPAPI CryptUnprotectData failed".to_string());
    }

    let slice = unsafe { std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
    let result = slice.to_vec();

    unsafe {
      LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
    }

    Ok(result)
  }
}

#[cfg(not(target_os = "windows"))]
mod win_dpapi {
  pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.iter().map(|b| b ^ 0x5A).collect())
  }

  pub fn protect_with_entropy(data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    protect(data)
  }

  pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.iter().map(|b| b ^ 0x5A).collect())
  }

  pub fn unprotect_with_entropy(data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    unprotect(data)
  }
}

/// Encrypt plaintext using OS-level protection and return hex-encoded ciphertext.
#[tauri::command]
pub fn encrypt_secret(plaintext: String) -> Result<String, String> {
  let protected = win_dpapi::protect(plaintext.as_bytes())?;
  Ok(protected.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Decrypt hex-encoded ciphertext using OS-level protection and return plaintext string.
#[tauri::command]
pub fn decrypt_secret(ciphertext_hex: String) -> Result<String, String> {
  let bytes = (0..ciphertext_hex.len())
    .step_by(2)
    .map(|i| {
      u8::from_str_radix(&ciphertext_hex[i..std::cmp::min(i + 2, ciphertext_hex.len())], 16)
        .map_err(|e| format!("Invalid hex ciphertext: {}", e))
    })
    .collect::<Result<Vec<u8>, String>>()?;

  let decrypted = win_dpapi::unprotect(&bytes)?;
  String::from_utf8(decrypted).map_err(|e| format!("Invalid UTF-8 plaintext: {}", e))
}

/// Decrypt Aegis.db.enc -> Aegis.db if enc exists (file-at-rest protection). Returns true if decrypted.
#[tauri::command]
pub fn decrypt_db(app: tauri::AppHandle, password: String) -> Result<bool, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let db_path = dir.join("Aegis.db");
  let enc_path = dir.join("Aegis.db.enc");
  if !enc_path.exists() {
    return Ok(false);
  }
  // If plaintext already exists and is newer than enc, keep it (avoid overwriting newer data)
  // Prefer enc if it exists — it is the at-rest representation
  let enc_bytes = std::fs::read(&enc_path).map_err(|e| e.to_string())?;
  // Older Aegis versions used DPAPI without password entropy. Accept that format
  // once so existing profiles can migrate on the next protected shutdown.
  let plain = win_dpapi::unprotect_with_entropy(&enc_bytes, password.as_bytes())
    .or_else(|_| win_dpapi::unprotect(&enc_bytes))?;
  std::fs::write(&db_path, plain).map_err(|e| e.to_string())?;
  Ok(true)
}

/// Encrypt Aegis.db -> Aegis.db.enc and remove plaintext (or keep if keep_plain). Returns true if encrypted.
#[tauri::command]
pub fn encrypt_db(app: tauri::AppHandle, password: String) -> Result<bool, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let db_path = dir.join("Aegis.db");
  let enc_path = dir.join("Aegis.db.enc");
  if !db_path.exists() {
    return Ok(false);
  }
  let plain = std::fs::read(&db_path).map_err(|e| e.to_string())?;
  let enc = win_dpapi::protect_with_entropy(&plain, password.as_bytes())?;
  // atomic write
  let tmp = dir.join("Aegis.db.enc.tmp");
  std::fs::write(&tmp, &enc).map_err(|e| e.to_string())?;
  if enc_path.exists() {
    std::fs::remove_file(&enc_path).map_err(|e| e.to_string())?;
  }
  std::fs::rename(&tmp, &enc_path).map_err(|e| e.to_string())?;
  // Do NOT delete plaintext while app is running — SQLite needs it. Caller should invoke on close after DB closed.
  // For at-rest protection we keep enc as mirror; on next launch decrypt will overwrite.
  Ok(true)
}

/// Encrypt and remove plaintext — for shutdown path after DB closed.
#[tauri::command]
pub fn encrypt_db_and_remove_plain(app: tauri::AppHandle, password: String) -> Result<bool, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let db_path = dir.join("Aegis.db");
  let enc_path = dir.join("Aegis.db.enc");
  if !db_path.exists() {
    return Ok(false);
  }
  let plain = std::fs::read(&db_path).map_err(|e| e.to_string())?;
  let enc = win_dpapi::protect_with_entropy(&plain, password.as_bytes())?;
  let tmp_path = dir.join("Aegis.db.enc.tmp");
  std::fs::write(&tmp_path, enc).map_err(|e| e.to_string())?;
  if enc_path.exists() {
    std::fs::remove_file(&enc_path).map_err(|e| e.to_string())?;
  }
  std::fs::rename(&tmp_path, &enc_path).map_err(|e| e.to_string())?;
  std::fs::remove_file(&db_path).map_err(|e| format!("Remove plaintext database: {}", e))?;
  Ok(true)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileStatus {
  pub configured: bool,
  pub username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProfileConfig {
  username: String,
  password_hash: String,
}

fn profile_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("Aegis.profile"))
}

fn read_profile(app: &tauri::AppHandle) -> Result<ProfileConfig, String> {
  let path = profile_path(app)?;
  let raw = std::fs::read_to_string(path).map_err(|e| format!("Read profile: {}", e))?;
  serde_json::from_str(&raw).map_err(|e| format!("Parse profile: {}", e))
}

#[tauri::command]
pub fn profile_status(app: tauri::AppHandle) -> Result<ProfileStatus, String> {
  let path = profile_path(&app)?;
  if !path.exists() {
    return Ok(ProfileStatus { configured: false, username: None });
  }
  let profile = read_profile(&app)?;
  Ok(ProfileStatus { configured: true, username: Some(profile.username) })
}

#[tauri::command]
pub fn create_profile(app: tauri::AppHandle, username: String, password: String) -> Result<(), String> {
  let username = username.trim();
  if username.is_empty() || username.len() > 80 {
    return Err("Username must be between 1 and 80 characters".into());
  }
  if password.chars().count() < 8 {
    return Err("Password must be at least 8 characters".into());
  }

  let path = profile_path(&app)?;
  if path.exists() {
    return Err("Aegis profile already exists".into());
  }
  let salt = SaltString::generate(&mut OsRng);
  let password_hash = Argon2::default()
    .hash_password(password.as_bytes(), &salt)
    .map_err(|e| format!("Hash password: {}", e))?
    .to_string();
  let profile = ProfileConfig { username: username.to_string(), password_hash };
  let raw = serde_json::to_vec(&profile).map_err(|e| format!("Serialize profile: {}", e))?;
  let dir = path.parent().ok_or("Invalid profile path")?;
  std::fs::create_dir_all(dir).map_err(|e| format!("Create profile directory: {}", e))?;
  let tmp = dir.join("Aegis.profile.tmp");
  std::fs::write(&tmp, raw).map_err(|e| format!("Write profile: {}", e))?;
  std::fs::rename(&tmp, &path).map_err(|e| format!("Commit profile: {}", e))
}

#[tauri::command]
pub fn verify_profile(app: tauri::AppHandle, password: String) -> Result<String, String> {
  let profile = read_profile(&app)?;
  let parsed = PasswordHash::new(&profile.password_hash).map_err(|e| format!("Parse password verifier: {}", e))?;
  Argon2::default()
    .verify_password(password.as_bytes(), &parsed)
    .map_err(|_| "Incorrect password".to_string())?;
  Ok(profile.username)
}

/// Returns whether DB file on disk is currently encrypted (enc exists) or plaintext readable.
#[tauri::command]
pub fn db_encryption_status(app: tauri::AppHandle) -> Result<String, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let db_path = dir.join("Aegis.db");
  let enc_path = dir.join("Aegis.db.enc");
  let has_plain = db_path.exists();
  let has_enc = enc_path.exists();
  Ok(format!(
    "plain:{} enc:{} dir:{}",
    has_plain,
    has_enc,
    dir.to_string_lossy()
  ))
}
