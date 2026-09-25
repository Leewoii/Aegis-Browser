import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bug,
  Check,
  ImagePlus,
  Lightbulb,
  Loader2,
  Megaphone,
  Search,
  Send,
  X,
} from "lucide-react";
import type { DevLogEntry, DevConsoleStats } from "../services/devConsole";
import type { StorageDiagnosticsResult } from "../services/storage";
import {
  filesToImageAttachments,
  getFeedbackWorkerUrl,
  submitFeedback,
  type FeedbackImageAttachment,
  type FeedbackKind,
  type FeedbackRecord,
} from "../services/feedback";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: DevLogEntry[];
  stats?: DevConsoleStats;
  diagnostics?: StorageDiagnosticsResult | null;
}

type Step = "select" | "form" | "done";

const ACCENT: Record<FeedbackKind, string> = {
  bug: "#f43f5e",
  feature: "#34d399",
};

export function FeedbackModal({ isOpen, onClose, logs, stats, diagnostics }: FeedbackModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeSysInfo, setIncludeSysInfo] = useState(true);
  const [images, setImages] = useState<FeedbackImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isReadingImages, setIsReadingImages] = useState(false);
  const workerUrl = getFeedbackWorkerUrl();
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentRecord, setSentRecord] = useState<FeedbackRecord | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep("select");
      setKind(null);
      setTitle("");
      setBody("");
      setLogSearch("");
      setSelectedIds(new Set());
      setIncludeSysInfo(true);
      setImages([]);
      setImageError(null);
      setSendError(null);
      setSentRecord(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && step === "form") {
      setTimeout(() => titleRef.current?.focus(), 60);
    }
  }, [isOpen, step]);

  const visibleLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const base = logs.slice(-200).reverse();
    if (!q) return base;
    return base.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q),
    );
  }, [logs, logSearch]);

  if (!isOpen) return null;

  const accent = kind ? ACCENT[kind] : "#6e9bff";

  const pickKind = (next: FeedbackKind) => {
    setKind(next);
    setStep("form");
    setSendError(null);
  };

  const toggleLog = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImageError(null);
    setIsReadingImages(true);
    try {
      const next = await filesToImageAttachments(files);
      setImages((prev) => [...prev, ...next].slice(0, 4));
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Could not read images.");
    } finally {
      setIsReadingImages(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canSend =
    title.trim().length >= 3 && body.trim().length >= 5 && !isSending && workerUrl.trim().length > 0;

  const handleSend = async () => {
    if (!kind || !canSend) return;
    setIsSending(true);
    setSendError(null);
    try {
      const trimmedWorker = workerUrl.trim().replace(/\/$/, "");
      const attachedLogs =
        kind === "bug" ? logs.filter((l) => selectedIds.has(l.id)) : undefined;
      const record = await submitFeedback(
        {
          kind,
          title: title.trim().slice(0, 140),
          body: body.trim().slice(0, 8000),
          createdAt: new Date().toISOString(),
          appVersion: "1.4.2",
          platform: navigator.platform || "unknown",
          logs: attachedLogs && attachedLogs.length > 0 ? attachedLogs : undefined,
          logIds: attachedLogs && attachedLogs.length > 0 ? attachedLogs.map((l) => l.id) : undefined,
          stats: includeSysInfo ? stats : undefined,
          diagnostics: includeSysInfo ? (diagnostics ?? null) : null,
          images: kind === "feature" && images.length > 0 ? images : undefined,
        },
        trimmedWorker,
      );
      setSentRecord(record);
      setStep("done");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="workspace-modal-overlay" onClick={onClose}>
      <div
        className="workspace-modal-card feedback-wide no-drag"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback to dev"
      >
        <div
          className="workspace-modal-glow"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${accent}26 0%, transparent 70%)` }}
        />

        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <span
              className="workspace-modal-icon-badge"
              style={{ color: accent, borderColor: `${accent}40`, backgroundColor: `${accent}15` }}
            >
              <Megaphone size={18} strokeWidth={2} />
            </span>
            <div>
              <h2 className="workspace-modal-title">
                {step === "select" && "Report or Request"}
                {step === "form" && kind === "bug" && "Report a problem"}
                {step === "form" && kind === "feature" && "Request a feature"}
                {step === "done" && "Sent to dev"}
              </h2>
              <p className="workspace-modal-subtitle">
                {step === "select" && "Choose what you want to send to the developer"}
                {step === "form" && kind === "bug" && "Attach the exact log lines that show the issue"}
                {step === "form" && kind === "feature" && "Describe the idea — pictures help"}
                {step === "done" && "Track it in your Cloudflare Worker dashboard"}
              </p>
            </div>
          </div>
          <button className="workspace-modal-close" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="workspace-modal-body feedback-body">
          {step === "select" && (
            <div className="feedback-type-grid">
              <button type="button" className="feedback-type-card bug" onClick={() => pickKind("bug")}>
                <span className="feedback-type-icon"><Bug size={20} /></span>
                <strong>Report a problem</strong>
                <small>Bug, crash, wrong data — pick log lines as proof</small>
              </button>
              <button
                type="button"
                className="feedback-type-card feature"
                onClick={() => pickKind("feature")}
              >
                <span className="feedback-type-icon"><Lightbulb size={20} /></span>
                <strong>Request a feature</strong>
                <small>New idea or improvement — attach mockup pictures</small>
              </button>
            </div>
          )}

          {step === "form" && kind && (
            <>
              <button type="button" className="feedback-back" onClick={() => setStep("select")}>
                <ArrowLeft size={13} /> Back to selection
              </button>

              <div className="workspace-modal-field">
                <label className="workspace-modal-label" htmlFor="feedback-title">Title</label>
                <input
                  id="feedback-title"
                  ref={titleRef}
                  type="text"
                  className="workspace-modal-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === "bug" ? "e.g. SQLite write fails after reload" : "e.g. Pin tabs to sidebar"}
                  maxLength={140}
                />
              </div>

              <div className="workspace-modal-field">
                <label className="workspace-modal-label" htmlFor="feedback-body">
                  {kind === "bug" ? "What happened?" : "Describe the idea"}
                </label>
                <textarea
                  id="feedback-body"
                  className="workspace-modal-input feedback-textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    kind === "bug"
                      ? "Steps to reproduce, what you expected, what you saw instead…"
                      : "What should it do, where should it live, example workflow…"
                  }
                  rows={4}
                  maxLength={8000}
                />
              </div>

              {kind === "bug" && (
                <div className="workspace-modal-field">
                  <label className="workspace-modal-label">
                    Attach logs {selectedIds.size > 0 && <span className="feedback-count">{selectedIds.size} selected</span>}
                  </label>
                  <div className="feedback-log-search">
                    <Search size={13} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Filter logs…"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                    />
                    {visibleLogs.length > 0 && (
                      <button
                        type="button"
                        className="feedback-link-btn"
                        onClick={() => {
                          if (selectedIds.size === visibleLogs.length) setSelectedIds(new Set());
                          else setSelectedIds(new Set(visibleLogs.map((l) => l.id)));
                        }}
                      >
                        {selectedIds.size === visibleLogs.length ? "Clear" : "Select all"}
                      </button>
                    )}
                  </div>
                  <div className="feedback-log-list">
                    {visibleLogs.length === 0 && <div className="feedback-log-empty">No logs match.</div>}
                    {visibleLogs.map((log) => {
                      const checked = selectedIds.has(log.id);
                      return (
                        <label key={log.id} className={`feedback-log-row ${checked ? "checked" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLog(log.id)}
                          />
                          <span className="log-time">{log.timeFormatted}</span>
                          <span className={`log-level-badge ${log.level}`}>{log.level.toUpperCase()}</span>
                          <span className="feedback-log-title" title={log.message}>
                            {log.title}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <label className="feedback-check">
                    <input
                      type="checkbox"
                      checked={includeSysInfo}
                      onChange={(e) => setIncludeSysInfo(e.target.checked)}
                    />
                    <span>Include system stats + diagnostics snapshot</span>
                  </label>
                </div>
              )}

              {kind === "feature" && (
                <div className="workspace-modal-field">
                  <label className="workspace-modal-label">Pictures (optional, stored as base64)</label>
                  <div className="feedback-images">
                    {images.map((img, i) => (
                      <div key={`${img.name}-${i}`} className="feedback-image-thumb">
                        <img src={img.dataUrl} alt={img.name} />
                        <button
                          type="button"
                          className="feedback-image-remove"
                          title={`Remove ${img.name}`}
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <X size={12} />
                        </button>
                        <span className="feedback-image-name" title={img.name}>{img.name}</span>
                      </div>
                    ))}
                    {images.length < 4 && (
                      <button
                        type="button"
                        className="feedback-image-add"
                        onClick={() => fileRef.current?.click()}
                        disabled={isReadingImages}
                      >
                        {isReadingImages ? <Loader2 size={16} className="dev-spin" /> : <ImagePlus size={16} />}
                        <span>{isReadingImages ? "Reading…" : "Add picture"}</span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => void handleFiles(e.target.files)}
                  />
                  {imageError && <div className="feedback-error">{imageError}</div>}
                  <div className="feedback-hint">PNG/JPG/WebP up to 4MB each, max 4. Converted to base64 data URLs automatically.</div>
                </div>
              )}

              {sendError && <div className="feedback-error">{sendError}</div>}

              <div className="workspace-modal-footer">
                <button type="button" className="workspace-modal-btn cancel" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="workspace-modal-btn submit"
                  style={{ backgroundColor: accent, color: "#05060b", boxShadow: `0 2px 14px ${accent}40` }}
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                >
                  {isSending ? (
                    <>
                      <Loader2 size={14} className="dev-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Send size={14} /> Send to Dev
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === "done" && sentRecord && (
            <div className="feedback-done">
              <span className="feedback-done-icon"><Check size={20} /></span>
              <h3>{sentRecord.kind === "bug" ? "Problem reported" : "Feature requested"}</h3>
              <p>
                ID <code>{sentRecord.id}</code> is now in your Worker dashboard with status{" "}
                <strong>{sentRecord.status}</strong>.
              </p>
              {workerUrl.trim() && (
                <a
                  className="feedback-dashboard-link"
                  href={`${workerUrl.trim().replace(/\/$/, "")}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Worker dashboard →
                </a>
              )}
              <div className="workspace-modal-footer">
                <button type="button" className="workspace-modal-btn cancel" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="workspace-modal-btn submit"
                  style={{ backgroundColor: accent, color: "#05060b" }}
                  onClick={() => {
                    setStep("select");
                    setKind(null);
                    setSentRecord(null);
                  }}
                >
                  Send another
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
