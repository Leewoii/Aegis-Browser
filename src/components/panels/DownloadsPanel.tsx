import { Pause, Play, RotateCcw, Trash2, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { DownloadEntry } from "../../types";
import { formatBytes } from "../../utils/format";

interface DownloadsPanelProps {
  downloads: DownloadEntry[];
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatEta(totalBytes: number, receivedBytes: number, speed?: number): string | null {
  if (!speed || speed <= 0 || totalBytes <= receivedBytes) return null;
  const remainingSeconds = Math.round((totalBytes - receivedBytes) / speed);
  if (remainingSeconds < 60) return `${remainingSeconds}s left`;
  if (remainingSeconds < 3600) {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${mins}m ${secs}s left`;
  }
  const hours = Math.floor(remainingSeconds / 3600);
  const mins = Math.floor((remainingSeconds % 3600) / 60);
  return `${hours}h ${mins}m left`;
}

export function DownloadsPanel({
  downloads,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDelete,
}: DownloadsPanelProps) {
  const getStateBadge = (dl: DownloadEntry) => {
    const state = dl.state || (dl.completed ? "completed" : "in_progress");
    switch (state) {
      case "completed":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#10b981", fontSize: 11 }}>
            <CheckCircle2 size={12} /> Completed
          </span>
        );
      case "in_progress":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#3b82f6", fontSize: 11 }}>
            <Clock size={12} /> Downloading
          </span>
        );
      case "paused":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#f59e0b", fontSize: 11 }}>
            <Pause size={12} /> Paused
          </span>
        );
      case "failed":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#ef4444", fontSize: 11 }}>
            <AlertCircle size={12} /> Interrupted
          </span>
        );
      case "cancelled":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#6b7280", fontSize: 11 }}>
            <X size={12} /> Cancelled
          </span>
        );
    }
  };

  return (
    <div className="list-panel">
      <div className="list-panel-header">
        <h3>Downloads</h3>
      </div>
      <div className="list-items">
        {downloads.length === 0 && <div className="list-empty">No downloads yet.</div>}
        {downloads.map((dl) => {
          const state = dl.state || (dl.completed ? "completed" : "in_progress");
          const pct = dl.totalBytes > 0 ? (dl.receivedBytes / dl.totalBytes) * 100 : 0;
          const eta = state === "in_progress" ? formatEta(dl.totalBytes, dl.receivedBytes, dl.speed) : null;
          const speedStr =
            state === "in_progress" && dl.speed && dl.speed > 0 ? `${formatBytes(dl.speed)}/s` : null;

          return (
            <div key={dl.id} className="download-row" style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div className="download-title" style={{ maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dl.filename}
                </div>
                <div>{getStateBadge(dl)}</div>
              </div>

              <div className="download-bar" style={{ margin: "6px 0" }}>
                <div
                  className={`download-bar-fill ${state === "completed" ? "done" : ""}`}
                  style={{
                    width: `${state === "completed" ? 100 : Math.min(pct, 100)}%`,
                    background: state === "failed" ? "#ef4444" : state === "paused" ? "#f59e0b" : undefined,
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <div className="download-status" style={{ fontSize: 11 }}>
                  {state === "completed" ? (
                    `${formatBytes(dl.totalBytes)}`
                  ) : state === "in_progress" ? (
                    <span>
                      {pct > 0 ? `${pct.toFixed(0)}% · ` : ""}
                      {formatBytes(dl.receivedBytes)} of {dl.totalBytes > 0 ? formatBytes(dl.totalBytes) : "..."}
                      {speedStr && <strong style={{ color: "var(--accent-a, #6e9bff)", marginLeft: 6 }}>{speedStr}</strong>}
                      {eta && <span style={{ opacity: 0.75, marginLeft: 6 }}>({eta})</span>}
                    </span>
                  ) : (
                    `${pct.toFixed(0)}% · ${formatBytes(dl.receivedBytes)} of ${formatBytes(dl.totalBytes)}`
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {state === "in_progress" && onPause && (
                    <button
                      className="icon-button"
                      title="Pause Download"
                      style={{ padding: 2, height: 22, width: 22 }}
                      onClick={() => onPause(dl.id)}
                    >
                      <Pause size={12} />
                    </button>
                  )}
                  {state === "paused" && onResume && (
                    <button
                      className="icon-button"
                      title="Resume Download"
                      style={{ padding: 2, height: 22, width: 22 }}
                      onClick={() => onResume(dl.id)}
                    >
                      <Play size={12} />
                    </button>
                  )}
                  {(state === "in_progress" || state === "paused") && onCancel && (
                    <button
                      className="icon-button"
                      title="Cancel Download"
                      style={{ padding: 2, height: 22, width: 22 }}
                      onClick={() => onCancel(dl.id)}
                    >
                      <X size={12} />
                    </button>
                  )}
                  {(state === "failed" || state === "cancelled") && onRetry && (
                    <button
                      className="icon-button"
                      title="Retry Download"
                      style={{ padding: 2, height: 22, width: 22 }}
                      onClick={() => onRetry(dl.id)}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="icon-button"
                      title="Remove from List"
                      style={{ padding: 2, height: 22, width: 22 }}
                      onClick={() => onDelete(dl.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
