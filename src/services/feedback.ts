import type { DevLogEntry, DevConsoleStats } from "./devConsole";
import type { StorageDiagnosticsResult } from "./storage";

export type FeedbackKind = "bug" | "feature";

export type FeedbackStatus = "new" | "in-progress" | "done" | "rejected";

export interface FeedbackImageAttachment {
  name: string;
  mime: string;
  size: number;
  /** data URL (base64) e.g. data:image/png;base64,... */
  dataUrl: string;
}

export interface FeedbackPayload {
  kind: FeedbackKind;
  title: string;
  body: string;
  createdAt: string;
  appVersion: string;
  platform: string;
  /** Full log objects the user attached (bug reports) */
  logs?: DevLogEntry[];
  logIds?: string[];
  stats?: DevConsoleStats;
  diagnostics?: StorageDiagnosticsResult | null;
  images?: FeedbackImageAttachment[];
}

export interface FeedbackRecord extends FeedbackPayload {
  id: string;
  status: FeedbackStatus;
  adminNote?: string;
  updatedAt?: string;
}

const DEFAULT_WORKER_URL = "https://aegis-feedback.leeroi-c25.workers.dev";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB per image before base64
const MAX_IMAGES = 4;

export function getFeedbackWorkerUrl(): string {
  const fromEnv = (import.meta.env.VITE_FEEDBACK_WORKER_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_WORKER_URL;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

export async function filesToImageAttachments(files: FileList | File[]): Promise<FeedbackImageAttachment[]> {
  const list = Array.from(files).slice(0, MAX_IMAGES);
  const out: FeedbackImageAttachment[] = [];
  for (const file of list) {
    if (!file.type.startsWith("image/")) {
      throw new Error(`"${file.name}" is not an image.`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`"${file.name}" exceeds 4MB. Please compress or crop it.`);
    }
    const dataUrl = await fileToBase64(file);
    out.push({ name: file.name, mime: file.type, size: file.size, dataUrl });
  }
  return out;
}

export async function submitFeedback(
  payload: FeedbackPayload,
  workerUrl: string = getFeedbackWorkerUrl(),
): Promise<FeedbackRecord> {
  if (!workerUrl) {
    throw new Error("Feedback Worker URL is not configured.");
  }
  const res = await fetch(`${workerUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Send failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
  return (await res.json()) as FeedbackRecord;
}
