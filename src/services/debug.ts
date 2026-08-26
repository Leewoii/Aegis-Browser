import { invoke } from "@tauri-apps/api/core";

const DEBUG_ENABLED = true;

export async function debugLog(message: string): Promise<void> {
  if (!DEBUG_ENABLED) return;
  try {
    await invoke("debug_log", { message });
  } catch {
    // ignore debug logging failures
  }
}
