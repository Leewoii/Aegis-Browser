use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

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

async fn probe_file(
  client: &reqwest::Client,
  url: &str,
) -> (Option<u64>, bool, Option<String>, Option<String>) {
  // Try HEAD first
  if let Ok(resp) = client.head(url).send().await {
    let total = resp.content_length();
    let accept_ranges = resp
      .headers()
      .get("accept-ranges")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_lowercase().contains("bytes"))
      .unwrap_or(false);
    let etag = resp
      .headers()
      .get("etag")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_string());
    let cd_filename = resp
      .headers()
      .get("content-disposition")
      .and_then(|v| v.to_str().ok())
      .and_then(parse_content_disposition_filename);
    if total.is_some() {
      return (total, accept_ranges, etag, cd_filename);
    }
    // Even if no length, return what we have
    if accept_ranges || etag.is_some() {
      return (total, accept_ranges, etag, cd_filename);
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
            let etag = resp
              .headers()
              .get("etag")
              .and_then(|v| v.to_str().ok())
              .map(|s| s.to_string());
            let cd_filename = resp
              .headers()
              .get("content-disposition")
              .and_then(|v| v.to_str().ok())
              .and_then(parse_content_disposition_filename);
            return (Some(total), true, etag, cd_filename);
          }
        }
      }
    }
    // If 200 on range probe, server ignores Range
    let total = resp.content_length();
    let etag = resp
      .headers()
      .get("etag")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_string());
    let cd_filename = resp
      .headers()
      .get("content-disposition")
      .and_then(|v| v.to_str().ok())
      .and_then(parse_content_disposition_filename);
    return (total, false, etag, cd_filename);
  }
  (None, false, None, None)
}

fn load_control(dest: &Path) -> Option<DownloadControlFile> {
  let cp = control_path(dest);
  if !cp.exists() {
    return None;
  }
  let data = std::fs::read_to_string(&cp).ok()?;
  serde_json::from_str(&data).ok()
}

fn save_control(dest: &Path, ctrl: &DownloadControlFile) {
  let cp = control_path(dest);
  if let Ok(data) = serde_json::to_string_pretty(ctrl) {
    let _ = std::fs::write(cp, data);
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
) -> Result<(), String> {
  let mut request = client.get(&url);
  if resume_offset > 0 {
    request = request.header("Range", format!("bytes={}-", resume_offset));
  }
  let resp = request.send().await.map_err(|e| e.to_string())?;
  let status = resp.status();
  // If we requested resume but server returned 200, restart from 0
  let effective_offset = if resume_offset > 0 && status == 206 {
    resume_offset
  } else if resume_offset > 0 && status == 200 {
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
    if last_emit.elapsed().as_millis() >= 120 || chunk.len() > 64 * 1024 {
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
  etag: Option<String>,
) -> Result<(), String> {
  // Decide connections: IDM dynamic 8 default, aria2 -x16 max. Use 8 for >=5MB, else fewer
  let max_conn = if total < 2 * 1024 * 1024 {
    1
  } else if total < 10 * 1024 * 1024 {
    4
  } else {
    8
  };
  if max_conn == 1 {
    return download_single(
      client, url, dest, filename, id, app, cancel, pause, 0, total,
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
      etag: etag.clone(),
    },
  );

  let total_received = Arc::new(Mutex::new(
    segments.iter().map(|s| s.downloaded).sum::<u64>(),
  ));
  let segments_shared = Arc::new(Mutex::new(segments));
  let control_dest = dest.clone();
  let control_url = url.clone();
  let control_filename = filename.clone();
  let control_etag = etag.clone();
  let control_total = total;

  let mut handles = Vec::new();
  for idx in 0..max_conn {
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
    let c_total = control_total;
    handles.push(tokio::spawn(async move {
      // Each worker picks its segment idx initially, but IDM work-stealing: if its segment done, steal largest
      let mut current_idx = idx;
      loop {
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
              if rem < 256 * 1024 {
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
                if rem < 256 * 1024 {
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
        let range = format!("bytes={}-{}", seg_start, end);
        let mut req = client_c.get(&url_c).header("Range", range);
        if let Some(ref et) = c_etag {
          req = req.header("If-Match", et.clone());
        }
        let resp = match req.send().await {
          Ok(r) => r,
          Err(e) => return Err(e.to_string()),
        };
        if resp.status() != 206 {
          return Err(format!("Range not supported during segmented download, got {}", resp.status()));
        }
        let mut stream = resp.bytes_stream();
        let mut file = tokio::fs::OpenOptions::new()
          .write(true)
          .open(&dest_c)
          .await
          .map_err(|e| e.to_string())?;
        file
          .seek(SeekFrom::Start(seg_start))
          .await
          .map_err(|e| e.to_string())?;
        let mut local_downloaded = already;
        let mut last_save = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();
        while let Some(chunk_res) = stream.next().await {
          if *cancel_c.lock().unwrap() {
            return Ok(());
          }
          if *pause_c.lock().unwrap() {
            return Ok(());
          }
          let chunk = chunk_res.map_err(|e| e.to_string())?;
          file.write_all(&chunk).await.map_err(|e| e.to_string())?;
          local_downloaded += chunk.len() as u64;
          {
            let mut segs = segs_c.lock().unwrap();
            if current_idx < segs.len() {
              segs[current_idx].downloaded = local_downloaded;
            }
          }
          let mut tot = received_c.lock().unwrap();
          *tot += chunk.len() as u64;
          let tot_val = *tot;
          drop(tot);
          if last_emit.elapsed().as_millis() >= 150 {
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
          if last_save.elapsed().as_millis() >= 800 {
            last_save = std::time::Instant::now();
            let segs_clone = segs_c.lock().unwrap().clone();
            save_control(
              &c_dest,
              &DownloadControlFile {
                url: c_url.clone(),
                filename: c_filename.clone(),
                total: c_total,
                segments: segs_clone,
                etag: c_etag.clone(),
              },
            );
          }
          if local_downloaded >= (end - start + 1) {
            break;
          }
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
            etag: etag.clone(),
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
          etag: etag.clone(),
        },
      );
      let _ = app.emit("download-paused", serde_json::json!({ "id": id }));
      return Ok(());
    }
  }

  if let Some(err) = first_err {
    // fallback to single if range not supported
    if err.contains("Range not supported") {
      let _ = tokio::fs::remove_file(&dest).await;
      remove_control(&dest);
      return download_single(
        client, url, dest, filename, id, app, cancel, pause, 0, total,
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

      let (total_opt, accept_ranges, etag, cd_filename) = probe_file(&client, &url_for_task).await;
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

      // If control file exists and segmented, go segmented path
      let _use_segmented = total > 0
        && accept_ranges
        && total >= 1024 * 1024
        && load_control(&final_dest).is_some()
          || (total >= 2 * 1024 * 1024 && accept_ranges);

      // Actually decide: if total >= 1MB and accept_ranges, use segmented
      let should_segment = total >= 1024 * 1024 && accept_ranges && total > 0;

      if should_segment {
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
          etag,
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
