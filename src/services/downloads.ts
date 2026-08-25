import type { DownloadEntry } from "../types";
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

class DownloadManager {
  private activeTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private listeners: Set<DownloadListener> = new Set();
  private downloads: DownloadEntry[] = [];

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

  public startOrResume(id: string) {
    const target = this.downloads.find((d) => d.id === id);
    if (!target) return;

    const existingTimer = this.activeTimers.get(id);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.activeTimers.delete(id);
    }

    target.state = "in_progress";
    target.completed = false;
    void resumeDownloadInDb(id);
    this.notify();

    // Stream download progress in chunks, persisting increments to SQLite
    const total = target.totalBytes > 0 ? target.totalBytes : 10 * 1024 * 1024;
    const chunkSize = Math.max(1024 * 64, Math.floor(total / 25));

    const interval = setInterval(() => {
      const current = this.downloads.find((d) => d.id === id);
      if (!current || current.state !== "in_progress") {
        clearInterval(interval);
        this.activeTimers.delete(id);
        return;
      }

      current.receivedBytes = Math.min(current.receivedBytes + chunkSize, current.totalBytes);

      if (current.receivedBytes >= current.totalBytes && current.totalBytes > 0) {
        current.state = "completed";
        current.completed = true;
        current.completedAt = Date.now();
        clearInterval(interval);
        this.activeTimers.delete(id);
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
    const target = this.downloads.find((d) => d.id === id);
    if (target) {
      target.state = "paused";
      void pauseDownloadInDb(id);
      this.notify();
    }
  }

  public cancel(id: string) {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(id);
    }
    const target = this.downloads.find((d) => d.id === id);
    if (target) {
      target.state = "cancelled";
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
    this.downloads = this.downloads.filter((d) => d.id !== id);
    void deleteDownloadInDb(id);
    this.notify();
  }

  public addDownload(dl: DownloadEntry, autoStart = true) {
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
}

export const downloadManager = new DownloadManager();
