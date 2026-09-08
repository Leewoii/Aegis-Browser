import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DownloadEntry } from "../types";
import { devConsole } from "./devConsole";
import {
  upsertDownload,
  pauseDownload as pauseDownloadInDb,
  resumeDownload as resumeDownloadInDb,
  cancelDownload as cancelDownloadInDb,
  retryDownload as retryDownloadInDb,
  deleteDownload as deleteDownloadInDb,
  saveDownloads,
} from "./storage";

type DownloadListener = (downloads: DownloadEntry[]) => void;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const [k, v] of parsed.searchParams.entries()) {
      if (k.toLowerCase() === "filename") return v;
      if (k.toLowerCase() === "response-content-disposition" || k.toLowerCase() === "rscd") {
        const m = v.match(/filename="?([^";]+)"?/i);
        if (m) return m[1];
      }
    }
    const last = parsed.pathname.split("/").pop();
    if (last && last.includes(".")) return last;
  } catch {}
  const withoutQuery = url.split("?")[0].split("#")[0];
  const last = withoutQuery.split("/").pop();
  if (last) return last;
  return "download.bin";
}

class DownloadManager {
  private activeTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private speedTracking: Map<string, { time: number; bytes: number }> = new Map();
  private listeners: Set<DownloadListener> = new Set();
  private downloads: DownloadEntry[] = [];
  private tauriListenersReady = false;

  public subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    listener(this.downloads);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.downloads];
    for (const l of this.listeners) {
      l(copy);
    }
  }

  public setDownloads(dls: DownloadEntry[]) {
    this.downloads = dls;
    this.notify();
  }

  public getDownloads(): DownloadEntry[] {
    return [...this.downloads];
  }

  private ensureTauriListeners() {
    if (this.tauriListenersReady || !isTauri()) return;
    this.tauriListenersReady = true;

    void listen<{ id: string; filename: string; url: string; received: number; total: number }>(
      "download-progress",
      (e) => {
        const { id, received, total } = e.payload;
        const target = this.downloads.find((d) => d.id === id);
        if (!target) return;
        target.receivedBytes = received;
        if (total > 0) target.totalBytes = total;
        target.state = "in_progress";
        target.completed = false;

        const now = Date.now();
        const prev = this.speedTracking.get(id);
        if (prev) {
          const elapsedSec = (now - prev.time) / 1000;
          if (elapsedSec >= 0.25) {
            const deltaBytes = Math.max(0, received - prev.bytes);
            target.speed = Math.round(deltaBytes / elapsedSec);
            this.speedTracking.set(id, { time: now, bytes: received });
          }
        } else {
          this.speedTracking.set(id, { time: now, bytes: received });
          target.speed = 0;
        }

        this.notify();
        void upsertDownload({ ...target });
      },
    );
    void listen<{ id: string; filename: string; url: string; path: string; total: number }>(
      "download-finished",
      (e) => {
        const { id, total, path: dest } = e.payload;
        const target = this.downloads.find((d) => d.id === id);
        if (!target) return;
        target.receivedBytes = total;
        target.totalBytes = total;
        target.state = "completed";
        target.completed = true;
        target.speed = 0;
        this.speedTracking.delete(id);
        target.completedAt = Date.now();
        target.destination = dest;
        this.notify();
        void upsertDownload({ ...target });
        // IDM-style: try to start next queued item
        this.dequeueAndStartNext();
      },
    );
    void listen<{ id: string; error: string }>("download-error", (e) => {
      const { id, error } = e.payload;
      const target = this.downloads.find((d) => d.id === id);
      if (!target) return;
      console.error("Download error", id, error);
      devConsole.frontend("error", "Download Failed", error, { id, url: target.url, filename: target.filename, error });
      target.state = "failed";
      target.completed = false;
      target.speed = 0;
      this.speedTracking.delete(id);
      this.notify();
      void upsertDownload({ ...target });
      this.dequeueAndStartNext();
    });
    void listen<{ id: string }>("download-cancelled", (e) => {
      const { id } = e.payload;
      const target = this.downloads.find((d) => d.id === id);
      if (!target) return;
      target.state = "cancelled";
      target.speed = 0;
      this.speedTracking.delete(id);
      this.notify();
      void upsertDownload({ ...target });
      this.dequeueAndStartNext();
    });
    void listen<{ id: string }>("download-paused", (e) => {
      const { id } = e.payload;
      const target = this.downloads.find((d) => d.id === id);
      if (!target) return;
      target.state = "paused";
      target.speed = 0;
      this.speedTracking.delete(id);
      this.notify();
      void upsertDownload({ ...target });
    });
  }

  private maxConcurrent = 3;
  private pendingQueue: string[] = [];

  private canStartImmediately(): boolean {
    const active = this.downloads.filter((d) => d.state === "in_progress").length;
    return active < this.maxConcurrent;
  }

  private dequeueAndStartNext() {
    if (this.pendingQueue.length === 0) return;
    if (!this.canStartImmediately()) return;
    const nextId = this.pendingQueue.shift();
    if (!nextId) return;
    const target = this.downloads.find((d) => d.id === nextId);
    if (target && target.state === "paused") {
      this.startOrResume(nextId);
    }
  }

  public startOrResume(id: string) {
    const target = this.downloads.find((d) => d.id === id);
    if (!target) return;

    // IDM-style queue: if at max concurrency, enqueue and pause
    if (!this.canStartImmediately() && target.state !== "in_progress") {
      if (!this.pendingQueue.includes(id)) {
        this.pendingQueue.push(id);
        target.state = "paused";
        this.notify();
        void upsertDownload({ ...target });
        // ensure listeners and mark as queued (paused) until slot frees
        return;
      }
    }

    const existingTimer = this.activeTimers.get(id);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.activeTimers.delete(id);
    }

    const prevState = target.state;
    const wasPaused = prevState === "paused" || target.receivedBytes > 0;
    target.state = "in_progress";
    target.completed = false;
    void resumeDownloadInDb(id);
    this.notify();

    this.ensureTauriListeners();

    if (isTauri()) {
      // Real download via Rust — segmented engine (IDM dynamic + aria2 pieces)
      // If this is a resume of a paused segmented download, invoke resume_download first
      const invokeResume = wasPaused && target.receivedBytes > 0 && target.receivedBytes < target.totalBytes;
      const startPromise = invokeResume
        ? invoke<string>("resume_download", { id: target.id })
            .then(() => invoke<string>("start_download", { id: target.id, url: target.url }))
        : invoke<string>("start_download", { id: target.id, url: target.url });
      startPromise
        .then((dest) => {
          target.destination = dest;
          void upsertDownload({ ...target });
        })
        .catch((err) => {
          const msg = String(err);
          if (msg.toLowerCase().includes("cancelled")) {
            target.state = "cancelled";
            target.completed = false;
            target.speed = 0;
            this.speedTracking.delete(target.id);
            void cancelDownloadInDb(target.id);
            this.notify();
            return;
          }
          console.error("start_download failed", err);
          devConsole.frontend("error", "Start Download Failed", String(err), { id: target.id, url: target.url, error: err }, err instanceof Error ? err.stack : undefined);
          target.state = "failed";
          target.completed = false;
          target.speed = 0;
          this.speedTracking.delete(target.id);
          this.notify();
          void upsertDownload({ ...target });
        });
      return;
    }

    // Non-Tauri (vite preview) — simulate
    this.startSimulated(id);
  }

  private startSimulated(id: string) {
    const target = this.downloads.find((d) => d.id === id);
    if (!target) return;
    const total = target.totalBytes > 0 ? target.totalBytes : 10 * 1024 * 1024;
    const chunkSize = Math.max(1024 * 64, Math.floor(total / 25));

    const interval = setInterval(() => {
      const current = this.downloads.find((d) => d.id === id);
      if (!current || current.state !== "in_progress") {
        clearInterval(interval);
        this.activeTimers.delete(id);
        this.speedTracking.delete(id);
        return;
      }

      const now = Date.now();
      const prev = this.speedTracking.get(id);
      if (prev) {
        const elapsedSec = (now - prev.time) / 1000;
        if (elapsedSec > 0) {
          const deltaBytes = Math.max(0, current.receivedBytes + chunkSize - prev.bytes);
          current.speed = Math.round(deltaBytes / elapsedSec);
        }
      }
      this.speedTracking.set(id, { time: now, bytes: current.receivedBytes + chunkSize });

      current.receivedBytes = Math.min(current.receivedBytes + chunkSize, current.totalBytes);

      if (current.receivedBytes >= current.totalBytes && current.totalBytes > 0) {
        current.state = "completed";
        current.completed = true;
        current.speed = 0;
        current.completedAt = Date.now();
        clearInterval(interval);
        this.activeTimers.delete(id);
        this.speedTracking.delete(id);
        void upsertDownload(current);
        this.notify();
      } else {
        void upsertDownload(current);
        this.notify();
      }
    }, 400);

    this.activeTimers.set(id, interval);
  }

  public pause(id: string) {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(id);
    }
    this.speedTracking.delete(id);
    const target = this.downloads.find((d) => d.id === id);
    if (target) {
      target.state = "paused";
      target.speed = 0;
      void pauseDownloadInDb(id);
      this.notify();
      if (isTauri()) {
        void invoke("pause_download", { id }).catch(() => undefined);
      }
    }
    // free slot for queue
    this.dequeueAndStartNext();
  }

  public cancel(id: string) {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(id);
    }
    this.speedTracking.delete(id);
    if (isTauri()) {
      void invoke("cancel_download", { id }).catch(() => undefined);
    }
    const target = this.downloads.find((d) => d.id === id);
    if (target) {
      target.state = "cancelled";
      target.speed = 0;
      void cancelDownloadInDb(id);
      this.notify();
    }
  }

  public retry(id: string) {
    const target = this.downloads.find((d) => d.id === id);
    if (target) {
      target.receivedBytes = 0;
      target.state = "in_progress";
      target.completed = false;
      target.speed = 0;
      void retryDownloadInDb(id);
      this.startOrResume(id);
    }
  }

  public delete(id: string) {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(id);
    }
    this.speedTracking.delete(id);
    if (isTauri()) {
      void invoke("cancel_download", { id }).catch(() => undefined);
    }
    this.downloads = this.downloads.filter((d) => d.id !== id);
    void deleteDownloadInDb(id);
    this.notify();
  }

  public addDownload(dl: DownloadEntry, autoStart = true) {
    // Ensure filename is sensible for display
    if (!dl.filename || dl.filename === "download.bin") {
      dl.filename = filenameFromUrl(dl.url);
    }
    this.ensureTauriListeners();
    this.downloads = [dl, ...this.downloads.filter((d) => d.id !== dl.id)];
    void upsertDownload(dl);
    this.notify();
    if (autoStart) {
      this.startOrResume(dl.id);
    }
  }

  public clearAll() {
    for (const timer of this.activeTimers.values()) {
      clearInterval(timer);
    }
    this.activeTimers.clear();
    // Cancel all active Tauri downloads
    if (isTauri()) {
      for (const dl of this.downloads) {
        if (dl.state === "in_progress") {
          void invoke("cancel_download", { id: dl.id }).catch(() => undefined);
        }
      }
    }
    this.downloads = [];
    this.notify();
    void saveDownloads([]);
  }

  /**
   * Automatically resumes paused or interrupted downloads upon application startup.
   */
  public autoResumePending() {
    for (const dl of this.downloads) {
      if (dl.state === "paused" || dl.state === "in_progress") {
        this.startOrResume(dl.id);
      }
    }
  }

  public handleExternalDownload(url: string) {
    const filename = filenameFromUrl(url);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: DownloadEntry = {
      id,
      filename,
      url,
      totalBytes: 0,
      receivedBytes: 0,
      completed: false,
      state: "in_progress",
      createdAt: Date.now(),
      startedAt: Date.now(),
    };
    this.addDownload(entry, true);
  }
}

export const downloadManager = new DownloadManager();
