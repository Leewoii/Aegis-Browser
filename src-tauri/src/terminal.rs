use std::collections::HashMap;
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
pub struct TerminalOutputPayload {
  pub id: String,
  pub data: String,
}

#[allow(dead_code)]
#[derive(Clone, Serialize, Deserialize)]
pub struct TerminalExitPayload {
  pub id: String,
  pub code: Option<i32>,
}

pub(crate) struct TerminalInstance {
  master: Box<dyn MasterPty + Send>,
  child: Box<dyn portable_pty::Child + Send + Sync>,
  writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
}

pub struct TerminalState(pub Arc<Mutex<HashMap<String, TerminalInstance>>>);

impl Default for TerminalState {
  fn default() -> Self {
    TerminalState(Arc::new(Mutex::new(HashMap::new())))
  }
}

fn shell_command(shell: &str) -> (String, Vec<String>) {
  match shell.to_lowercase().as_str() {
    "cmd" | "command prompt" | "cmd.exe" => ("cmd.exe".to_string(), vec![]),
    _ => ("powershell.exe".to_string(), vec!["-NoLogo".to_string()]),
  }
}

#[tauri::command]
pub async fn create_terminal(
  app: AppHandle,
  state: tauri::State<'_, TerminalState>,
  id: String,
  shell: String,
  cols: Option<u16>,
  rows: Option<u16>,
) -> Result<String, String> {
  // Close existing if any
  let old = {
    let mut map = state.0.lock().await;
    map.remove(&id)
  };
  if let Some(mut inst) = old {
    let _ = inst.child.kill();
  }

  let (exe, args) = shell_command(&shell);
  let cols = cols.unwrap_or(80);
  let rows = rows.unwrap_or(24);

  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows,
      cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("Failed to open pty: {}", e))?;

  let mut cmd = CommandBuilder::new(&exe);
  for arg in &args {
    cmd.arg(arg);
  }
  if let Ok(home) = app.path().home_dir() {
    cmd.cwd(home);
  }

  let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Failed to spawn {}: {}", exe, e))?;
  // Drop slave, keep master
  drop(pair.slave);

  let mut reader = pair
    .master
    .try_clone_reader()
    .map_err(|e| format!("Failed to clone reader: {}", e))?;
  let writer = pair.master.take_writer().map_err(|e| format!("Failed to take writer: {}", e))?;
  let writer_arc = Arc::new(Mutex::new(writer as Box<dyn std::io::Write + Send>));

  let master_for_map = pair.master;

  let id_clone = id.clone();
  let app_clone = app.clone();

  // Spawn reader thread — ConPTY on Windows is blocking, so use a dedicated OS thread
  std::thread::spawn(move || {
    let mut buf = vec![0u8; 4096];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let data = String::from_utf8_lossy(&buf[..n]).to_string();
          let _ = app_clone.emit(
            "terminal-output",
            TerminalOutputPayload {
              id: id_clone.clone(),
              data,
            },
          );
        }
        Err(_) => break,
      }
    }
  });

  let instance = TerminalInstance {
    master: master_for_map,
    child,
    writer: writer_arc,
  };

  {
    let mut map = state.0.lock().await;
    map.insert(id.clone(), instance);
  }

  let _ = app.emit(
    "terminal-output",
    TerminalOutputPayload {
      id: id.clone(),
      data: format!("\x1b[90m[{} started — backspace & clear now work via ConPTY]\x1b[0m\r\n", exe),
    },
  );

  Ok(id)
}

#[tauri::command]
pub async fn write_terminal(
  state: tauri::State<'_, TerminalState>,
  id: String,
  data: String,
) -> Result<(), String> {
  let writer_arc = {
    let map = state.0.lock().await;
    let inst = map.get(&id).ok_or(format!("Terminal {} not found", id))?;
    inst.writer.clone()
  };

  let mut writer = writer_arc.lock().await;
  use std::io::Write;
  writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  writer.flush().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
  state: tauri::State<'_, TerminalState>,
  id: String,
  cols: u16,
  rows: u16,
) -> Result<(), String> {
  let map = state.0.lock().await;
  if let Some(inst) = map.get(&id) {
    let _ = inst.master.resize(PtySize {
      rows,
      cols,
      pixel_width: 0,
      pixel_height: 0,
    });
  }
  Ok(())
}

#[tauri::command]
pub async fn close_terminal(
  state: tauri::State<'_, TerminalState>,
  id: String,
) -> Result<(), String> {
  let inst_opt = {
    let mut map = state.0.lock().await;
    map.remove(&id)
  };
  if let Some(mut inst) = inst_opt {
    let _ = inst.child.kill();
  }
  Ok(())
}

#[tauri::command]
pub async fn execute_command(shell: String, command: String) -> Result<String, String> {
  let (exe, mut base_args) = shell_command(&shell);
  let output;
  if exe == "cmd.exe" {
    base_args.push("/C".to_string());
    base_args.push(command);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(&base_args);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    output = cmd.output().await.map_err(|e| e.to_string())?;
  } else {
    base_args.push("-Command".to_string());
    base_args.push(command);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(&base_args);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    output = cmd.output().await.map_err(|e| e.to_string())?;
  }
  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();
  if !stderr.is_empty() {
    Ok(format!("{}{}", stdout, stderr))
  } else {
    Ok(stdout)
  }
}
