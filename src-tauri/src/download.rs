use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
  pub id: String,
  pub filename: String,
  pub url: String,
  pub received: u64,
  pub total: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadFinishedPayload {
  pub id: String,
  pub filename: String,
  pub url: String,
  pub path: String,
  pub total: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadErrorPayload {
  pub id: String,
  pub error: String,
}

type CancelMap = Arc<Mutex<HashMap<String, Arc<Mutex<bool>>>>>;

pub struct DownloadState(pub CancelMap);

impl Default for DownloadState {
  fn default() -> Self {
    DownloadState(Arc::new(Mutex::new(HashMap::new())))
  }
}

fn sanitize_filename(input: &str) -> String {
  let cleaned: String = input
    .chars()
    .map(|c| if r#"/\:*?"<>|"#.contains(c) { '_' } else { c })
    .collect();
  let trimmed = cleaned.trim();
  if trimmed.is_empty() {
    "download.bin".to_string()
  } else {
    trimmed.to_string()
  }
}

fn filename_from_url(url: &str) -> String {
  // Try to extract from query params like response-content-disposition=attachment; filename=xxx or rscd or filename=
  if let Ok(parsed) = url::Url::parse(url) {
    for (k, v) in parsed.query_pairs() {
      let kl = k.to_lowercase();
      if kl == "filename" {
        return sanitize_filename(&v);
      }
      if kl == "response-content-disposition" || kl == "rscd" {
        // value is like "attachment; filename=npp.8.9.8.Installer.x64.exe"
        if let Some(pos) = v.to_lowercase().find("filename=") {
          let start = pos + 9;
          let mut name = v[start..].trim().trim_matches('"').trim_matches('\'').to_string();
          // trim until ; or end
          if let Some(semi) = name.find(';') {
            name = name[..semi].to_string();
          }
          name = name.trim().to_string();
          // URL decode if needed
          if let Ok(decoded) = urlencoding::decode(&name) {
            return sanitize_filename(&decoded);
          }
          return sanitize_filename(&name);
        }
      }
      // GitHub release asset URLs encode disposition in `response-content-disposition`
      // already handled; also check plain `filename*` etc.
    }
    // Fallback: last path segment
    if let Some(segments) = parsed.path_segments() {
      if let Some(last) = segments.last() {
        if !last.is_empty() && last.contains('.') {
          return sanitize_filename(last);
        }
      }
    }
  }
  // Last resort: take after last / before ?
  let without_query = url.split('?').next().unwrap_or(url);
  if let Some(last) = without_query.rsplit('/').next() {
    if !last.is_empty() {
      return sanitize_filename(last);
    }
  }
  "download.bin".to_string()
}

fn download_dir(app: &AppHandle) -> PathBuf {
  // Try Tauri download dir, then dirs crate, then temp
  if let Ok(p) = app.path().download_dir() {
    return p;
  }
  if let Some(p) = dirs::download_dir() {
    return p;
  }
  std::env::temp_dir()
}

fn resolve_destination(dir: &PathBuf, filename: &str) -> Result<PathBuf, String> {
  let suggested = dir.join(filename);
  if !suggested.exists() {
    return Ok(suggested);
  }
  // Filename collision — show native Save dialog so user can choose name/location/overwrite.
  // This matches standard browser behavior: only prompt when conflict exists.
  let chosen = rfd::FileDialog::new()
    .set_directory(dir)
    .set_file_name(filename)
    .save_file()
    .ok_or_else(|| "Download cancelled by user".to_string())?;
  Ok(chosen)
}

#[tauri::command]
pub async fn start_download(
  app: AppHandle,
  state: tauri::State<'_, DownloadState>,
  id: String,
  url: String,
) -> Result<String, String> {
  let filename = filename_from_url(&url);
  let dir = download_dir(&app);
  // Ensure dir exists
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  // Resolve destination — only prompt if file already exists (standard browser behavior)
  let dest = resolve_destination(&dir, &filename)?;

  let dest_clone = dest.clone();
  let id_clone = id.clone();
  let filename_clone = filename.clone();
  let url_clone = url.clone();
  let app_clone = app.clone();

  // Register cancel flag
  let cancel_flag = Arc::new(Mutex::new(false));
  {
    let mut map = state.0.lock().map_err(|_| "cancel map poisoned".to_string())?;
    map.insert(id.clone(), Arc::clone(&cancel_flag));
  }
  let cancel_map = state.inner().0.clone();

  // Spawn download task
  tokio::spawn(async move {
    let result: Result<(), String> = async {
      let client = reqwest::Client::builder()
        .user_agent("AegisBrowser/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

      let resp = client.get(&url_clone).send().await.map_err(|e| e.to_string())?;
      if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url_clone));
      }

      let total = resp.content_length().unwrap_or(0);

      // Try to refine filename from Content-Disposition header
      let mut final_filename = filename_clone.clone();
      let mut final_dest = dest_clone.clone();
      if let Some(cd) = resp.headers().get("content-disposition") {
        if let Ok(cd_str) = cd.to_str() {
          if let Some(pos) = cd_str.to_lowercase().find("filename=") {
            let start = pos + 9;
            let mut name = cd_str[start..].trim().trim_matches('"').trim_matches('\'').to_string();
            if let Some(semi) = name.find(';') {
              name = name[..semi].to_string();
            }
            name = name.trim().to_string();
            if !name.is_empty() {
              let refined = sanitize_filename(&name);
              let candidate = dir.join(&refined);
              // If header suggests a different filename that already exists, prompt user (preserve pending download's dir/filename handling)
              if candidate != dest_clone && candidate.exists() {
                let chosen = rfd::FileDialog::new()
                  .set_directory(&dir)
                  .set_file_name(&refined)
                  .save_file()
                  .ok_or_else(|| "Download cancelled by user".to_string())?;
                final_dest = chosen.clone();
                final_filename = chosen
                  .file_name()
                  .and_then(|n| n.to_str())
                  .map(|s| s.to_string())
                  .unwrap_or(refined);
              } else {
                final_filename = refined;
                final_dest = candidate;
              }
            }
          }
        }
      }

      let mut file = tokio::fs::File::create(&final_dest).await.map_err(|e| e.to_string())?;
      let mut stream = resp.bytes_stream();
      let mut received: u64 = 0;

      while let Some(chunk_res) = stream.next().await {
        // Check cancel flag
        if *cancel_flag.lock().unwrap() {
          drop(file);
          let _ = tokio::fs::remove_file(&final_dest).await;
          let _ = app_clone.emit("download-cancelled", serde_json::json!({ "id": id_clone }));
          return Ok(());
        }

        let chunk = chunk_res.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;

        let _ = app_clone.emit(
          "download-progress",
          DownloadProgressPayload {
            id: id_clone.clone(),
            filename: final_filename.clone(),
            url: url_clone.clone(),
            received,
            total,
          },
        );
      }

      file.flush().await.map_err(|e| e.to_string())?;
      drop(file);

      let _ = app_clone.emit(
        "download-finished",
        DownloadFinishedPayload {
          id: id_clone.clone(),
          filename: final_filename.clone(),
          url: url_clone.clone(),
          path: final_dest.to_string_lossy().to_string(),
          total: received,
        },
      );

      Ok(())
    }
    .await;

    if let Err(err) = result {
      let _ = app_clone.emit(
        "download-error",
        DownloadErrorPayload {
          id: id_clone.clone(),
          error: err,
        },
      );
    }

    // Cleanup cancel flag
    if let Ok(mut map) = cancel_map.lock() {
      map.remove(&id_clone);
    }
  });

  Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_download(state: tauri::State<'_, DownloadState>, id: String) -> Result<(), String> {
  let map = state.0.lock().map_err(|_| "cancel map poisoned".to_string())?;
  if let Some(flag) = map.get(&id) {
    *flag.lock().map_err(|_| "flag poisoned".to_string())? = true;
  }
  Ok(())
}

#[tauri::command]
pub fn get_download_dir(app: AppHandle) -> Result<String, String> {
  Ok(download_dir(&app).to_string_lossy().to_string())
}
