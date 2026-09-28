use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentState {
  pub start: u64,
  pub end: u64,
  pub downloaded: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadControlFile {
  pub url: String,
  pub filename: String,
  pub total: u64,
  pub segments: Vec<SegmentState>,
  pub etag: Option<String>,
}

// ── Tuning: single source of truth for connection planning ────────────
/// Minimum file size worth segmenting at all.
const SEGMENT_MIN_BYTES: u64 = 1024 * 1024;
/// Below this size a single connection is used.
const TIER_SINGLE_MAX: u64 = 2 * 1024 * 1024;
/// Below this size 4 connections are used, otherwise 8 (IDM default).
const TIER_QUAD_MAX: u64 = 10 * 1024 * 1024;
/// Never split a remainder smaller than this (IDM "too small to split" rule).
const MIN_SPLIT_REMAINING: u64 = 256 * 1024;
/// Progress-event throttle per worker.
const PROGRESS_EMIT_MS: u128 = 150;
/// Control-file persist throttle per worker.
const CONTROL_SAVE_MS: u128 = 800;
/// Single-stream progress throttle (time- or size-based).
const SINGLE_EMIT_MS: u128 = 120;
const SINGLE_EMIT_BYTES: usize = 64 * 1024;
/// Resume overlap window (IDM corruption guard): re-fetch this many bytes
/// before the resume point and compare with what is on disk.
const OVERLAP_BYTES: u64 = 32 * 1024;
/// Attempts per segment fetch (initial + retries for transient failures).
const SEGMENT_ATTEMPTS: u32 = 3;
/// Worker error when the origin file changed mid-download (HTTP 412).
const ERR_SOURCE_CHANGED: &str = "Source changed during download (412 Precondition Failed)";
/// Worker error when the requested range is no longer satisfiable (HTTP 416).
const ERR_RANGE_UNSATISFIABLE: &str = "Range not satisfiable (416) — source changed";
/// Worker error when a resumed segment fails overlap verification twice.
const ERR_OVERLAP_MISMATCH: &str = "Overlap verification failed twice; stored data does not match server";

/// Back off between segment attempts. Returns false when paused/cancelled
/// during the wait (caller should yield immediately).
async fn retry_backoff(attempt: u32, cancel: &Arc<Mutex<bool>>, pause: &Arc<Mutex<bool>>) -> bool {
  let ms = std::cmp::min(500 * attempt as u64 * attempt as u64, 5000);
  tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
  !(cancel.lock().map(|v| *v).unwrap_or(true) || pause.lock().map(|v| *v).unwrap_or(true))
}

fn persist_segment_progress(
  segs: &Arc<Mutex<Vec<SegmentState>>>,
  idx: usize,
  downloaded: u64,
) {
  if let Ok(mut guard) = segs.lock() {
    if idx < guard.len() {
      guard[idx].downloaded = downloaded;
    }
  }
}

/// Verify whole-file hashes advertised by the server (no-op when absent).
/// Runs off the async runtime (blocking file read) via spawn_blocking.
async fn verify_file_hashes(dest: PathBuf, hashes: FileHashes) -> Result<(), String> {
  if hashes.md5.is_none() && hashes.sha256.is_none() {
    return Ok(());
  }
  tokio::task::spawn_blocking(move || {
    let data = std::fs::read(&dest).map_err(|e| format!("Verify read: {e}"))?;
    if let Some(expected) = &hashes.md5 {
      let got = <md5::Md5 as md5::Digest>::digest(&data);
      if got.as_slice() != expected.as_slice() {
        return Err("MD5 mismatch — file corrupted".to_string());
      }
    }
    if let Some(expected) = &hashes.sha256 {
      let got = <sha2::Sha256 as sha2::Digest>::digest(&data);
      if got.as_slice() != expected.as_slice() {
        return Err("SHA-256 mismatch — file corrupted".to_string());
      }
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Emit terminal corruption: file deleted, frontend shows retry distinctly.
fn emit_corrupt(app: &AppHandle, id: &str, dest: &Path, error: String) {
  let _ = std::fs::remove_file(dest);
  remove_control(dest);
  let _ = app.emit(
    "download-corrupt",
    DownloadErrorPayload { id: id.to_string(), error },
  );
}

/// How many parallel connections a download may open.
/// Returns 1 when the server ignores ranges or the file is too small —
/// callers fall back to single-stream in that case. `cap` is the
/// user/host-configured ceiling (default 8, IDM-style).
fn connection_plan(total: u64, accept_ranges: bool, cap: i32) -> i32 {
  let cap = cap.clamp(1, 16);
  if !accept_ranges || total < SEGMENT_MIN_BYTES {
    return 1;
  }
  let tiered = if total < TIER_SINGLE_MAX {
    1
  } else if total < TIER_QUAD_MAX {
    4
  } else {
    8
  };
  tiered.min(cap)
}

#[allow(dead_code)]
pub struct DownloadJob {
  pub cancel: Arc<Mutex<bool>>,
  pub pause: Arc<Mutex<bool>>,
  pub dest: PathBuf,
  pub filename: String,
  pub url: String,
  pub total: Option<u64>,
}

pub struct DownloadState {
  pub jobs: Arc<Mutex<HashMap<String, DownloadJob>>>,
}

impl Default for DownloadState {
  fn default() -> Self {
    Self {
      jobs: Arc::new(Mutex::new(HashMap::new())),
    }
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
  if let Ok(parsed) = url::Url::parse(url) {
    for (k, v) in parsed.query_pairs() {
      let kl = k.to_lowercase();
      if kl == "filename" {
        return sanitize_filename(&v);
      }
      if kl == "response-content-disposition" || kl == "rscd" {
        if let Some(pos) = v.to_lowercase().find("filename=") {
          let start = pos + 9;
          let mut name = v[start..].trim().trim_matches('"').trim_matches('\'').to_string();
          if let Some(semi) = name.find(';') {
            name = name[..semi].to_string();
          }
          name = name.trim().to_string();
          if let Ok(decoded) = urlencoding::decode(&name) {
            return sanitize_filename(&decoded);
          }
          return sanitize_filename(&name);
        }
      }
    }
    if let Some(segments) = parsed.path_segments() {
      if let Some(last) = segments.last() {
        if !last.is_empty() && last.contains('.') {
          return sanitize_filename(last);
        }
      }
    }
  }
  let without_query = url.split('?').next().unwrap_or(url);
  if let Some(last) = without_query.rsplit('/').next() {
    if !last.is_empty() {
      return sanitize_filename(last);
    }
  }
  "download.bin".to_string()
}

fn download_dir(app: &AppHandle) -> PathBuf {
  if let Ok(p) = app.path().download_dir() {
    return p;
  }
  if let Some(p) = dirs::download_dir() {
    return p;
  }
  std::env::temp_dir()
}

fn control_path(dest: &Path) -> PathBuf {
  let mut s = dest.as_os_str().to_owned();
  s.push(".aegis.json");
  PathBuf::from(s)
}

fn resolve_destination(dir: &PathBuf, filename: &str) -> Result<PathBuf, String> {
  let suggested = dir.join(filename);
  if !suggested.exists() && !control_path(&suggested).exists() {
    return Ok(suggested);
  }
  let chosen = rfd::FileDialog::new()
    .set_directory(dir)
    .set_file_name(filename)
    .save_file()
    .ok_or_else(|| "Download cancelled by user".to_string())?;
  Ok(chosen)
}

fn parse_content_disposition_filename(cd: &str) -> Option<String> {
  let lower = cd.to_lowercase();
  if let Some(pos) = lower.find("filename=") {
    let start = pos + 9;
    let mut name = cd[start..].trim().trim_matches('"').trim_matches('\'').to_string();
    if let Some(semi) = name.find(';') {
      name = name[..semi].to_string();
    }
    name = name.trim().to_string();
    if !name.is_empty() {
      return Some(sanitize_filename(&name));
    }
  }
  None
}

/// Conditional-request validators captured at probe time.
#[derive(Debug, Clone, Default)]
struct RequestValidators {
  etag: Option<String>,
  last_modified: Option<String>,
}

/// Whole-file integrity hashes advertised by the server (if any).
#[derive(Debug, Clone, Default)]
struct FileHashes {
  md5: Option<Vec<u8>>,
  sha256: Option<Vec<u8>>,
}

struct ProbeResult {
  total: Option<u64>,
  accept_ranges: bool,
  validators: RequestValidators,
  cd_filename: Option<String>,
  hashes: FileHashes,
}

fn decode_b64_hash(s: &str, len: usize) -> Option<Vec<u8>> {
  use base64::Engine as _;
  base64::engine::general_purpose::STANDARD
    .decode(s.trim())
    .ok()
    .filter(|b| b.len() == len)
}

/// Parses `Digest` / `x-goog-hash` style `k=b64, k=b64` values.
fn parse_kv_hashes(value: &str) -> (Option<Vec<u8>>, Option<Vec<u8>>) {
  let mut md5 = None;
  let mut sha256 = None;
  for part in value.split(',') {
    let mut kv = part.splitn(2, '=');
    match (kv.next(), kv.next()) {
      (Some(k), Some(v)) => match k.trim().to_ascii_lowercase().as_str() {
        "md5" => {
          if md5.is_none() {
            md5 = decode_b64_hash(v, 16);
          }
        }
        "sha-256" | "sha256" => {
          if sha256.is_none() {
            sha256 = decode_b64_hash(v, 32);
          }
        }
        _ => {}
      },
      _ => {}
    }
  }
  (md5, sha256)
}

fn extract_hashes(headers: &reqwest::header::HeaderMap, hashes: &mut FileHashes) {
  if hashes.md5.is_none() {
    if let Some(v) = headers.get("content-md5").and_then(|h| h.to_str().ok()) {
      hashes.md5 = decode_b64_hash(v, 16);
    }
  }
  if hashes.md5.is_none() || hashes.sha256.is_none() {
    for name in ["digest", "x-goog-hash"] {
      if let Some(v) = headers.get(name).and_then(|h| h.to_str().ok()) {
        let (m, s) = parse_kv_hashes(v);
        if hashes.md5.is_none() {
          hashes.md5 = m;
        }
        if hashes.sha256.is_none() {
          hashes.sha256 = s;
        }
      }
    }
  }
}

fn extract_validators(headers: &reqwest::header::HeaderMap) -> RequestValidators {
  RequestValidators {
    etag: headers.get("etag").and_then(|v| v.to_str().ok()).map(|s| s.to_string()),
    last_modified: headers
      .get("last-modified")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_string()),
  }
}

async fn probe_file(client: &reqwest::Client, url: &str) -> ProbeResult {
  // Try HEAD first
  if let Ok(resp) = client.head(url).send().await {
    let total = resp.content_length();
    let accept_ranges = resp
      .headers()
      .get("accept-ranges")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_lowercase().contains("bytes"))
      .unwrap_or(false);
    let validators = extract_validators(resp.headers());
    let cd_filename = resp
      .headers()
      .get("content-disposition")
      .and_then(|v| v.to_str().ok())
      .and_then(parse_content_disposition_filename);
    let mut hashes = FileHashes::default();
    extract_hashes(resp.headers(), &mut hashes);
    if total.is_some() {
      return ProbeResult { total, accept_ranges, validators, cd_filename, hashes };
    }
    // Even if no length, return what we have
    if accept_ranges || validators.etag.is_some() {
      return ProbeResult { total, accept_ranges, validators, cd_filename, hashes };
    }
  }
  // Fallback: Range probe bytes=0-0 to test 206 support and get Content-Range
  if let Ok(resp) = client
    .get(url)
    .header("Range", "bytes=0-0")
    .send()
    .await
  {
    if resp.status() == 206 {
      if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
        // Content-Range: bytes 0-0/12345
        if let Some(slash) = cr.find('/') {
          if let Ok(total) = cr[slash + 1..].parse::<u64>() {
            let validators = extract_validators(resp.headers());
            let cd_filename = resp
              .headers()
              .get("content-disposition")
              .and_then(|v| v.to_str().ok())
              .and_then(parse_content_disposition_filename);
            let mut hashes = FileHashes::default();
            extract_hashes(resp.headers(), &mut hashes);
            return ProbeResult { total: Some(total), accept_ranges: true, validators, cd_filename, hashes };
          }
        }
      }
    }
    // If 200 on range probe, server ignores Range
    let total = resp.content_length();
    let validators = extract_validators(resp.headers());
    let cd_filename = resp
      .headers()
      .get("content-disposition")
      .and_then(|v| v.to_str().ok())
      .and_then(parse_content_disposition_filename);
    let mut hashes = FileHashes::default();
    extract_hashes(resp.headers(), &mut hashes);
    return ProbeResult { total, accept_ranges: false, validators, cd_filename, hashes };
  }
  ProbeResult { total: None, accept_ranges: false, validators: RequestValidators::default(), cd_filename: None, hashes: FileHashes::default() }
}

fn load_control(dest: &Path) -> Option<DownloadControlFile> {
  let cp = control_path(dest);
  if !cp.exists() {
    return None;
  }
  let data = std::fs::read(&cp).ok()?;
  // Control files hold URLs: stored DPAPI-encrypted. Accept legacy plaintext
  // (pre-encryption) once, then re-saved encrypted on next write.
  let json_bytes: Vec<u8> = match crate::security::win_dpapi::unprotect(&data) {
    Ok(plain) => plain,
    Err(_) => data,
  };
  let text = String::from_utf8(json_bytes).ok()?;
  serde_json::from_str(&text).ok()
}

fn save_control(dest: &Path, ctrl: &DownloadControlFile) {
  let cp = control_path(dest);
  if let Ok(data) = serde_json::to_vec(ctrl) {
    // DPAPI-wrap so resume state (URLs, filenames) is never plaintext.
    let stored = crate::security::win_dpapi::protect(&data).unwrap_or(data);
    let _ = std::fs::write(cp, stored);
  }
}

fn remove_control(dest: &Path) {
  let cp = control_path(dest);
  let _ = std::fs::remove_file(cp);
}

async fn download_single(
  client: reqwest::Client,
  url: String,
  dest: PathBuf,
  filename: String,
  id: String,
  app: AppHandle,
  cancel: Arc<Mutex<bool>>,
  pause: Arc<Mutex<bool>>,
  resume_offset: u64,
  total: u64,
  validators: RequestValidators,
  mut hashes: FileHashes,
) -> Result<(), String> {
  let mut request = client.get(&url);
  if resume_offset > 0 {
    request = request.header("Range", format!("bytes={}-", resume_offset));
    if let Some(ref et) = validators.etag {
      request = request.header("If-Match", et.clone());
    } else if let Some(ref lm) = validators.last_modified {
      request = request.header("If-Unmodified-Since", lm.clone());
    }
  }
  let resp = request.send().await.map_err(|e| e.to_string())?;
  let status = resp.status();
  // If we requested resume but server returned 200 (or 412: file changed),
  // restart from 0
  let effective_offset = if resume_offset > 0 && status == 206 {
    resume_offset
  } else if resume_offset > 0 && (status == 200 || status == 412) {
    // truncate file and start over
    let _ = tokio::fs::OpenOptions::new()
      .write(true)
      .truncate(true)
      .open(&dest)
      .await;
    0
  } else {
    0
  };
  if !resp.status().is_success() && resp.status() != 206 {
    return Err(format!("HTTP {} for {}", resp.status(), url));
  }
  // Learn the total late: some servers omit length on HEAD/probe but send it
  // on the real GET. 200 → Content-Length is the total; 206 → parse it out
  // of Content-Range (content_length would only be the remainder there).
  // Flips the UI from indeterminate to real % mid-download.
  let mut total = total;
  if total == 0 {
    if status == 200 {
      if let Some(len) = resp.content_length() {
        total = len;
      }
    } else if status == 206 {
      if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
        if let Some(slash) = cr.find('/') {
          if let Ok(t) = cr[slash + 1..].parse::<u64>() {
            total = t;
          }
        }
      }
    }
  }
  // Full GET responses often carry the content hashes — authoritative for
  // the bytes we are about to receive.
  extract_hashes(resp.headers(), &mut hashes);
  let mut file = if effective_offset > 0 {
    let mut f = tokio::fs::OpenOptions::new()
      .write(true)
      .open(&dest)
      .await
      .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(effective_offset))
      .await
      .map_err(|e| e.to_string())?;
    f
  } else {
    tokio::fs::File::create(&dest)
      .await
      .map_err(|e| e.to_string())?
  };
  let mut stream = resp.bytes_stream();
  let mut received = effective_offset;
  let mut last_emit = std::time::Instant::now();
  while let Some(chunk_res) = stream.next().await {
    if *cancel.lock().unwrap() {
      drop(file);
      let _ = tokio::fs::remove_file(&dest).await;
      remove_control(&dest);
      let _ = app.emit("download-cancelled", serde_json::json!({ "id": id }));
      return Ok(());
    }
    if *pause.lock().unwrap() {
      let _ = app.emit("download-paused", serde_json::json!({ "id": id }));
      return Ok(());
    }
    let chunk = chunk_res.map_err(|e| e.to_string())?;
    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    received += chunk.len() as u64;
    if last_emit.elapsed().as_millis() >= SINGLE_EMIT_MS || chunk.len() > SINGLE_EMIT_BYTES {
      last_emit = std::time::Instant::now();
      let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
          id: id.clone(),
          filename: filename.clone(),
          url: url.clone(),
          received,
          total,
        },
      );
    }
  }
  file.flush().await.map_err(|e| e.to_string())?;
  drop(file);
  if let Err(e) = verify_file_hashes(dest.clone(), hashes).await {
    emit_corrupt(&app, &id, &dest, e);
    return Ok(());
  }
  remove_control(&dest);
  let _ = app.emit(
    "download-finished",
    DownloadFinishedPayload {
      id: id.clone(),
      filename: filename.clone(),
      url: url.clone(),
      path: dest.to_string_lossy().to_string(),
      total: received,
    },
  );
  Ok(())
}

async fn download_segmented(
  client: reqwest::Client,
  url: String,
  dest: PathBuf,
  filename: String,
  id: String,
  app: AppHandle,
  cancel: Arc<Mutex<bool>>,
  pause: Arc<Mutex<bool>>,
  total: u64,
  validators: RequestValidators,
  hashes: FileHashes,
  max_conn: i32,
) -> Result<(), String> {
  if max_conn <= 1 {
    return download_single(
      client, url, dest, filename, id, app, cancel, pause, 0, total, validators, hashes,
    )
    .await;
  }

  // Try to resume from control file
  let segments: Vec<SegmentState> = if let Some(ctrl) = load_control(&dest) {
    if ctrl.total == total && ctrl.url == url && ctrl.segments.len() as u64 <= max_conn as u64 {
      ctrl.segments
    } else {
      (0..max_conn)
        .map(|i| {
          let chunk = total / max_conn as u64;
          let start = i as u64 * chunk;
          let end = if i == max_conn - 1 {
            total - 1
          } else {
            (i + 1) as u64 * chunk - 1
          };
          SegmentState {
            start,
            end,
            downloaded: 0,
          }
        })
        .collect()
    }
  } else {
    (0..max_conn)
      .map(|i| {
        let chunk = total / max_conn as u64;
        let start = i as u64 * chunk;
        let end = if i == max_conn - 1 {
          total - 1
        } else {
          (i + 1) as u64 * chunk - 1
        };
        SegmentState {
          start,
          end,
          downloaded: 0,
        }
      })
      .collect()
  };

  // Pre-allocate file if not exists or size mismatch
  let file_exists = dest.exists();
  if !file_exists {
    let f = tokio::fs::File::create(&dest)
      .await
      .map_err(|e| e.to_string())?;
    f.set_len(total).await.map_err(|e| e.to_string())?;
    drop(f);
  } else {
    // ensure size is total (sparse)
    if let Ok(meta) = tokio::fs::metadata(&dest).await {
      if meta.len() != total {
        let f = tokio::fs::OpenOptions::new()
          .write(true)
          .open(&dest)
          .await
          .map_err(|e| e.to_string())?;
        f.set_len(total).await.map_err(|e| e.to_string())?;
      }
    }
  }

  // Save initial control
  save_control(
    &dest,
    &DownloadControlFile {
      url: url.clone(),
      filename: filename.clone(),
      total,
      segments: segments.clone(),
      etag: validators.etag.clone(),
    },
  );

  let total_received = Arc::new(Mutex::new(
    segments.iter().map(|s| s.downloaded).sum::<u64>(),
  ));
  let segments_shared = Arc::new(Mutex::new(segments));
  let control_dest = dest.clone();
  let control_url = url.clone();
  let control_filename = filename.clone();
  let control_etag = validators.etag.clone();
  let control_total = total;
  let control_validators = validators.clone();

  let mut handles = Vec::new();
  for idx in 0..(max_conn as usize) {
    let client_c = client.clone();
    let url_c = url.clone();
    let dest_c = dest.clone();
    let filename_c = filename.clone();
    let id_c = id.clone();
    let app_c = app.clone();
    let cancel_c = Arc::clone(&cancel);
    let pause_c = Arc::clone(&pause);
    let received_c = Arc::clone(&total_received);
    let segs_c = Arc::clone(&segments_shared);
    let c_dest = control_dest.clone();
    let c_url = control_url.clone();
    let c_filename = control_filename.clone();
    let c_etag = control_etag.clone();
    let c_validators = control_validators.clone();
    let c_total = control_total;
    handles.push(tokio::spawn(async move {
      // Each worker picks its segment idx initially, but IDM work-stealing: if its segment done, steal largest
      let mut current_idx = idx;
      // Segments already overlap-retried once (mismatch -> full re-fetch, twice -> job fails over to single).
      let mut overlap_retried: Option<usize> = None;
      'worker: loop {
        if *cancel_c.lock().unwrap() {
          return Ok::<(), String>(());
        }
        if *pause_c.lock().unwrap() {
          return Ok::<(), String>(());
        }
        let (start, end, already) = {
          let segs = segs_c.lock().unwrap();
          if current_idx >= segs.len() {
            // Find largest remaining
            let mut best: Option<(usize, u64)> = None;
            for (i, s) in segs.iter().enumerate() {
              let rem = (s.end - s.start + 1) - s.downloaded;
              if rem > 0 {
                if best.is_none() || rem > best.unwrap().1 {
                  best = Some((i, rem));
                }
              }
            }
            if let Some((bi, rem)) = best {
              if rem < MIN_SPLIT_REMAINING {
                return Ok(());
              }
              // split largest in half (IDM dynamic)
              drop(segs);
              let mut segs_mut = segs_c.lock().unwrap();
              let target = &mut segs_mut[bi];
              let mid = target.start + target.downloaded + rem / 2;
              let original_end = target.end;
              target.end = mid - 1;
              let new_seg = SegmentState {
                start: mid,
                end: original_end,
                downloaded: 0,
              };
              segs_mut.push(new_seg);
              let new_idx = segs_mut.len() - 1;
              current_idx = new_idx;
              let s = &segs_mut[new_idx];
              (s.start, s.end, s.downloaded)
            } else {
              return Ok(());
            }
          } else {
            let s = &segs[current_idx];
            let rem = (s.end - s.start + 1) - s.downloaded;
            if rem == 0 {
              // try steal
              let mut best: Option<(usize, u64)> = None;
              for (i, seg) in segs.iter().enumerate() {
                let r = (seg.end - seg.start + 1) - seg.downloaded;
                if r > 0 && (best.is_none() || r > best.unwrap().1) {
                  best = Some((i, r));
                }
              }
              if let Some((bi, rem)) = best {
                if rem < MIN_SPLIT_REMAINING {
                  return Ok(());
                }
                drop(segs);
                let mut segs_mut = segs_c.lock().unwrap();
                let target = &mut segs_mut[bi];
                let mid = target.start + target.downloaded + rem / 2;
                let original_end = target.end;
                target.end = mid - 1;
                let new_seg = SegmentState {
                  start: mid,
                  end: original_end,
                  downloaded: 0,
                };
                segs_mut.push(new_seg);
                let new_idx = segs_mut.len() - 1;
                current_idx = new_idx;
                let s = &segs_mut[new_idx];
                (s.start, s.end, s.downloaded)
              } else {
                return Ok(());
              }
            } else {
              (s.start, s.end, s.downloaded)
            }
          }
        };
        let seg_start = start + already;
        if seg_start > end {
          // done
          // try next steal in next loop
          // mark as needing new assignment
          current_idx = usize::MAX;
          continue;
        }
        // Fetch attempts for this segment assignment. Transient failures
        // refetch the remainder (progress lives in shared state); deterministic
        // failures (412/416/non-206) abort the job immediately.
        let mut segment_done = false;
        'attempt: for attempt in 1..=SEGMENT_ATTEMPTS {
          if *cancel_c.lock().unwrap() {
            return Ok::<(), String>(());
          }
          if *pause_c.lock().unwrap() {
            return Ok::<(), String>(());
          }
          // Refresh progress: a previous attempt may have written more.
          let already_now: u64 = {
            let segs = segs_c.lock().unwrap();
            if current_idx < segs.len() {
              segs[current_idx].downloaded
            } else {
              already
            }
          };
          let seg_start_now = start + already_now;
          if seg_start_now > end {
            segment_done = true;
            break 'attempt;
          }
          // IDM overlap guard: when resuming mid-segment, re-fetch the trailing
          // OVERLAP_BYTES and compare with disk before trusting them.
          let mut fetch_start = seg_start_now;
          let mut overlap_expected: Option<Vec<u8>> = None;
          if already_now > 0 {
            let overlap = OVERLAP_BYTES.min(already_now);
            let check_start = seg_start_now - overlap;
            let mut probe = tokio::fs::File::open(&dest_c).await.map_err(|e| e.to_string())?;
            probe.seek(SeekFrom::Start(check_start)).await.map_err(|e| e.to_string())?;
            let mut expected = vec![0u8; overlap as usize];
            probe.read_exact(&mut expected).await.map_err(|e| e.to_string())?;
            drop(probe);
            fetch_start = check_start;
            overlap_expected = Some(expected);
          }
          let range = format!("bytes={}-{}", fetch_start, end);
          let mut req = client_c.get(&url_c).header("Range", range);
          if let Some(ref et) = c_validators.etag {
            req = req.header("If-Match", et.clone());
          } else if let Some(ref lm) = c_validators.last_modified {
            req = req.header("If-Unmodified-Since", lm.clone());
          }
          let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
              if attempt < SEGMENT_ATTEMPTS && retry_backoff(attempt, &cancel_c, &pause_c).await {
                continue 'attempt;
              }
              return Err(e.to_string());
            }
          };
          let status = resp.status();
          if status == 412 {
            return Err(ERR_SOURCE_CHANGED.to_string());
          }
          if status == 416 {
            return Err(ERR_RANGE_UNSATISFIABLE.to_string());
          }
          if status != 206 {
            if (status == 429 || status.is_server_error())
              && attempt < SEGMENT_ATTEMPTS
              && retry_backoff(attempt, &cancel_c, &pause_c).await
            {
              continue 'attempt;
            }
            return Err(format!("Range not supported during segmented download, got {status}"));
          }
          let mut stream = resp.bytes_stream();
          let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&dest_c)
            .await
            .map_err(|e| e.to_string())?;
          file
            .seek(SeekFrom::Start(seg_start_now))
            .await
            .map_err(|e| e.to_string())?;
          let mut local_downloaded = already_now;
          let mut overlap_skip = overlap_expected.as_ref().map(|v| v.len()).unwrap_or(0);
          let mut overlap_consumed = 0usize;
          let mut overlap_ok = true;
          let mut last_save = std::time::Instant::now();
          let mut last_emit = std::time::Instant::now();
          while let Some(chunk_res) = stream.next().await {
            if *cancel_c.lock().unwrap() {
              return Ok(());
            }
            if *pause_c.lock().unwrap() {
              return Ok(());
            }
            let chunk = match chunk_res {
              Ok(c) => c,
              Err(e) => {
                persist_segment_progress(&segs_c, current_idx, local_downloaded);
                if attempt < SEGMENT_ATTEMPTS && retry_backoff(attempt, &cancel_c, &pause_c).await {
                  continue 'attempt;
                }
                return Err(e.to_string());
              }
            };
            // Verify overlap bytes against disk; never write them (assumed identical).
            let mut writable = &chunk[..];
            if overlap_skip > 0 {
              let take = std::cmp::min(overlap_skip, chunk.len());
              if let Some(ref expected) = overlap_expected {
                if overlap_ok && chunk[..take] != expected[overlap_consumed..overlap_consumed + take] {
                  overlap_ok = false;
                }
              }
              overlap_consumed += take;
              overlap_skip -= take;
              writable = &chunk[take..];
              if writable.is_empty() {
                continue;
              }
            }
            if !overlap_ok {
              // Stored bytes diverge from the server: re-fetch this segment once.
              if overlap_retried == Some(current_idx) {
                return Err(ERR_OVERLAP_MISMATCH.to_string());
              }
              persist_segment_progress(&segs_c, current_idx, 0);
              overlap_retried = Some(current_idx);
              current_idx = usize::MAX;
              continue 'worker;
            }
            file.write_all(writable).await.map_err(|e| e.to_string())?;
            local_downloaded += writable.len() as u64;
            persist_segment_progress(&segs_c, current_idx, local_downloaded);
            let mut tot = received_c.lock().unwrap();
            *tot += writable.len() as u64;
            let tot_val = *tot;
            drop(tot);
            if last_emit.elapsed().as_millis() >= PROGRESS_EMIT_MS {
              last_emit = std::time::Instant::now();
              let _ = app_c.emit(
                "download-progress",
                DownloadProgressPayload {
                  id: id_c.clone(),
                  filename: filename_c.clone(),
                  url: url_c.clone(),
                  received: tot_val,
                  total: c_total,
                },
              );
            }
          if last_save.elapsed().as_millis() >= CONTROL_SAVE_MS {
            last_save = std::time::Instant::now();
            let segs_clone = segs_c.lock().unwrap().clone();
            save_control(
              &c_dest,
              &DownloadControlFile {
                url: c_url.clone(),
                filename: c_filename.clone(),
                total: c_total,
                segments: segs_clone.clone(),
                etag: c_etag.clone(),
              },
            );
            // Throttled per-segment telemetry for tuning (slow-tail visibility).
            let _ = app_c.emit(
              "download-segments",
              serde_json::json!({ "id": id_c, "segments": segs_clone }),
            );
          }
            if local_downloaded >= (end - start + 1) {
              segment_done = true;
              break;
            }
          }
          if segment_done {
            break 'attempt;
          }
          // Server closed the stream early: refetch the remainder if attempts remain.
          persist_segment_progress(&segs_c, current_idx, local_downloaded);
          if attempt < SEGMENT_ATTEMPTS && retry_backoff(attempt, &cancel_c, &pause_c).await {
            continue 'attempt;
          }
          return Err("Segment truncated by server".to_string());
        }
        // segment done, try steal next
        current_idx = usize::MAX;
      }
    }));
  }

  // Wait for all workers
  let mut first_err: Option<String> = None;
  for h in handles {
    match h.await {
      Ok(Ok(())) => {},
      Ok(Err(e)) => {
        if first_err.is_none() {
          first_err = Some(e);
        }
      },
      Err(e) => {
        if first_err.is_none() {
          first_err = Some(e.to_string());
        }
      },
    }
    if *cancel.lock().unwrap() {
      let _ = app.emit("download-cancelled", serde_json::json!({ "id": id }));
      // keep control for pause vs cancel distinction: if paused, keep, if cancelled, remove
      if *pause.lock().unwrap() {
        let segs_clone = segments_shared.lock().unwrap().clone();
        save_control(
          &dest,
          &DownloadControlFile {
            url: url.clone(),
            filename: filename.clone(),
            total,
            segments: segs_clone,
            etag: control_etag.clone(),
          },
        );
        let _ = app.emit("download-paused", serde_json::json!({ "id": id }));
      } else {
        let _ = tokio::fs::remove_file(&dest).await;
        remove_control(&dest);
      }
      return Ok(());
    }
    if *pause.lock().unwrap() {
      let segs_clone = segments_shared.lock().unwrap().clone();
      save_control(
        &dest,
        &DownloadControlFile {
          url: url.clone(),
          filename: filename.clone(),
          total,
          segments: segs_clone,
          etag: control_etag.clone(),
        },
      );
      let _ = app.emit("download-paused", serde_json::json!({ "id": id }));
      return Ok(());
    }
  }

  if let Some(err) = first_err {
    // Fallback to single-stream from scratch when ranges are refused, the
    // origin file changed mid-download (412/416), or resumed bytes repeatedly
    // fail overlap verification. The partial file is untrustworthy: drop it.
    if err.contains("Range not supported")
      || err.contains("(412")
      || err.contains("(416")
      || err.contains(ERR_OVERLAP_MISMATCH)
    {
      let _ = tokio::fs::remove_file(&dest).await;
      remove_control(&dest);
      return download_single(
        client, url, dest, filename, id, app, cancel, pause, 0, total,
        validators, hashes,
      )
      .await;
    }
    return Err(err);
  }

  // Verify all segments completed
  {
    let segs = segments_shared.lock().unwrap();
    for s in segs.iter() {
      if s.downloaded < (s.end - s.start + 1) {
        return Err("Segment incomplete".to_string());
      }
    }
  }

  if let Err(e) = verify_file_hashes(dest.clone(), hashes).await {
    emit_corrupt(&app, &id, &dest, e);
    return Ok(());
  }

  let total_received = *total_received.lock().unwrap();
  remove_control(&dest);
  let _ = app.emit(
    "download-finished",
    DownloadFinishedPayload {
      id: id.clone(),
      filename: filename.clone(),
      url: url.clone(),
      path: dest.to_string_lossy().to_string(),
      total: total_received,
    },
  );
  Ok(())
}

#[tauri::command]
pub async fn start_download(
  app: AppHandle,
  state: tauri::State<'_, DownloadState>,
  id: String,
  url: String,
  max_connections: Option<i32>,
  resume: Option<bool>,
) -> Result<String, String> {
  let filename = filename_from_url(&url);
  let dir = download_dir(&app);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  // Check existing job (resume case)
  let existing_dest = {
    let map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
    map.get(&id).map(|j| j.dest.clone())
  };

  let dest = if let Some(d) = existing_dest {
    d
  } else if resume.unwrap_or(false) {
    // Restart resume (e.g. auto-resume after app restart): the user already
    // chose this path once, so reuse it silently instead of prompting again.
    dir.join(&filename)
  } else {
    let dest = resolve_destination(&dir, &filename)?;
    // Register job
    let cancel = Arc::new(Mutex::new(false));
    let pause = Arc::new(Mutex::new(false));
    {
      let mut map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
      map.insert(
        id.clone(),
        DownloadJob {
          cancel: Arc::clone(&cancel),
          pause: Arc::clone(&pause),
          dest: dest.clone(),
          filename: filename.clone(),
          url: url.clone(),
          total: None,
        },
      );
    }
    dest
  };

  // Ensure job exists for resumed id without prior insert (e.g., after restart)
  let (cancel, pause) = {
    let map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
    if let Some(job) = map.get(&id) {
      (Arc::clone(&job.cancel), Arc::clone(&job.pause))
    } else {
      let cancel = Arc::new(Mutex::new(false));
      let pause = Arc::new(Mutex::new(false));
      drop(map);
      let mut map2 = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
      map2.insert(
        id.clone(),
        DownloadJob {
          cancel: Arc::clone(&cancel),
          pause: Arc::clone(&pause),
          dest: dest.clone(),
          filename: filename.clone(),
          url: url.clone(),
          total: None,
        },
      );
      (cancel, pause)
    }
  };
  // reset flags
  *cancel.lock().unwrap() = false;
  *pause.lock().unwrap() = false;

  let dest_clone = dest.clone();
  let id_clone = id.clone();
  let filename_clone = filename.clone();
  let url_clone = url.clone();
  let app_clone = app.clone();
  let jobs_clone = state.jobs.clone();

  // Clone for inner async to avoid move conflicts
  let id_for_task = id_clone.clone();
  let app_for_task = app_clone.clone();
  let url_for_task = url_clone.clone();
  let dest_for_task = dest_clone.clone();
  let filename_for_task = filename_clone.clone();
  let jobs_for_inner = jobs_clone.clone();
  tokio::spawn(async move {
    let result: Result<(), String> = async {
      let client = reqwest::Client::builder()
        .user_agent("AegisBrowser/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

      let probe = probe_file(&client, &url_for_task).await;
      let total_opt = probe.total;
      let accept_ranges = probe.accept_ranges;
      let validators = probe.validators;
      let cd_filename = probe.cd_filename;
      let hashes = probe.hashes;
      let mut final_filename = filename_for_task.clone();
      let mut final_dest = dest_for_task.clone();
      if let Some(refined) = cd_filename {
        if refined != filename_for_task {
          let candidate = download_dir(&app_for_task).join(&refined);
          if candidate != dest_for_task && candidate.exists() {
            if let Some(chosen) = rfd::FileDialog::new()
              .set_directory(download_dir(&app_for_task))
              .set_file_name(&refined)
              .save_file()
            {
              final_dest = chosen.clone();
              final_filename = chosen
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
                .unwrap_or(refined);
              // update job dest
              if let Ok(mut map) = jobs_for_inner.lock() {
                if let Some(job) = map.get_mut(&id_for_task) {
                  job.dest = final_dest.clone();
                  job.filename = final_filename.clone();
                }
              }
            }
          } else {
            final_filename = refined;
            final_dest = candidate;
            if let Ok(mut map) = jobs_for_inner.lock() {
              if let Some(job) = map.get_mut(&id_for_task) {
                job.dest = final_dest.clone();
                job.filename = final_filename.clone();
              }
            }
          }
        }
      }

      let total = total_opt.unwrap_or(0);

      // Determine resume offset for single-stream fallback (from existing file size + control)
      let resume_offset = if final_dest.exists() && !load_control(&final_dest).is_some() {
        // single-stream resume via file size
        tokio::fs::metadata(&final_dest)
          .await
          .map(|m| m.len())
          .unwrap_or(0)
      } else {
        0
      };

      // Single source of truth: 1 connection means single-stream.
      // The frontend passes the user setting + per-host override (default 8).
      let max_conn = connection_plan(total, accept_ranges, max_connections.unwrap_or(8));

      if max_conn > 1 {
        // Check if we have a partial single file that would conflict with segmented sparse file
        // If resume_offset >0 but no control, fallback to single resume to avoid corruption
        if resume_offset > 0 && load_control(&final_dest).is_none() && resume_offset < total {
          // resume single
          return download_single(
            client,
            url_for_task,
            final_dest,
            final_filename,
            id_for_task,
            app_for_task,
            cancel,
            pause,
            resume_offset,
            total,
            validators,
            hashes,
          )
          .await;
        }
        download_segmented(
          client,
          url_for_task,
          final_dest,
          final_filename,
          id_for_task,
          app_for_task,
          cancel,
          pause,
          total,
          validators,
          hashes,
          max_conn,
        )
        .await
      } else {
        download_single(
          client,
          url_for_task,
          final_dest,
          final_filename,
          id_for_task,
          app_for_task,
          cancel,
          pause,
          resume_offset,
          total,
          validators,
          hashes,
        )
        .await
      }
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
    if let Ok(mut map) = jobs_clone.lock() {
      // keep job for pause case? if paused, keep; else remove
      if let Some(job) = map.get(&id_clone) {
        let is_paused = *job.pause.lock().unwrap();
        if !is_paused {
          map.remove(&id_clone);
        }
      } else {
        map.remove(&id_clone);
      }
    }
  });

  Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_download(state: tauri::State<'_, DownloadState>, id: String) -> Result<(), String> {
  let map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
  if let Some(job) = map.get(&id) {
    *job.cancel.lock().map_err(|_| "flag poisoned".to_string())? = true;
    *job.pause.lock().map_err(|_| "flag poisoned".to_string())? = false;
  }
  Ok(())
}

#[tauri::command]
pub fn pause_download(state: tauri::State<'_, DownloadState>, id: String) -> Result<(), String> {
  let map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
  if let Some(job) = map.get(&id) {
    *job.pause.lock().map_err(|_| "flag poisoned".to_string())? = true;
  }
  Ok(())
}

#[tauri::command]
pub fn resume_download(state: tauri::State<'_, DownloadState>, id: String) -> Result<(), String> {
  let map = state.jobs.lock().map_err(|_| "jobs poisoned".to_string())?;
  if let Some(job) = map.get(&id) {
    *job.pause.lock().map_err(|_| "flag poisoned".to_string())? = false;
    *job.cancel.lock().map_err(|_| "flag poisoned".to_string())? = false;
  }
  Ok(())
}

#[tauri::command]
pub fn get_download_dir(app: AppHandle) -> Result<String, String> {
  Ok(download_dir(&app).to_string_lossy().to_string())
}

#[cfg(test)]
mod plan_tests {
  use super::*;

  #[test]
  fn connection_tiers() {
    assert_eq!(connection_plan(0, true, 8), 1);
    assert_eq!(connection_plan(500_000, true, 8), 1);
    assert_eq!(connection_plan(1_500_000, true, 8), 1);
    assert_eq!(connection_plan(5_000_000, true, 8), 4);
    assert_eq!(connection_plan(50_000_000, true, 8), 8);
    assert_eq!(connection_plan(50_000_000, false, 8), 1);
    assert_eq!(connection_plan(0, false, 8), 1);
    // User/host ceiling clamps the tier but never forces segmentation.
    assert_eq!(connection_plan(50_000_000, true, 2), 2);
    assert_eq!(connection_plan(50_000_000, true, 1), 1);
    assert_eq!(connection_plan(50_000_000, true, 32), 8);
    assert_eq!(connection_plan(50_000_000, true, 0), 1);
    assert_eq!(connection_plan(500_000, true, 16), 1);
  }

  #[test]
  fn hash_header_parsing() {
    // Wrong lengths are rejected.
    let (m, s) = parse_kv_hashes("sha-256=AAAA, md5=BBBB");
    assert!(m.is_none() && s.is_none());
    // Exact lengths accepted (16 zero bytes / 32 zero bytes).
    let (m, s) = parse_kv_hashes("SHA-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=, MD5=AAAAAAAAAAAAAAAAAAAAAA==");
    assert_eq!(m, Some(vec![0u8; 16]));
    assert_eq!(s, Some(vec![0u8; 32]));
    // Content-MD5 of empty string.
    let empty_md5 = decode_b64_hash("1B2M2Y8AsgTpgAmY7PhCfg==", 16).unwrap();
    assert_eq!(empty_md5, vec![0xd4, 0x1d, 0x8c, 0xd9, 0x8f, 0x00, 0xb2, 0x04, 0xe9, 0x80, 0x09, 0x98, 0xec, 0xf8, 0x42, 0x7e]);
    // Known-answer digests of "abc".
    let got_md5 = <md5::Md5 as md5::Digest>::digest(b"abc");
    assert_eq!(format!("{got_md5:x}"), "900150983cd24fb0d6963f7d28e17f72");
    let got_sha = <sha2::Sha256 as sha2::Digest>::digest(b"abc");
    assert_eq!(format!("{got_sha:x}"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // x-goog-hash style: crc32c ignored, md5 picked up.
    let (m2, s2) = parse_kv_hashes("crc32c=DUoZ3g==, md5=1B2M2Y8AsgTpgAmY7PhCfg==");
    assert_eq!(m2, Some(empty_md5));
    assert!(s2.is_none());
  }
}


