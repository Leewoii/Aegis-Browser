import { useMemo } from "react";
import type { HistoryEntry } from "../../types";
import { formatDayGroup, formatDateTime } from "../../utils/format";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
  onOpen: (entry: HistoryEntry) => void;
}

function domainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function displayUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function HistoryPanel({ entries, onClear, onOpen }: HistoryPanelProps) {
  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const key = formatDayGroup(entry.visitedAt);
      const list = map.get(key);
      if (list) {
        list.push(entry);
      } else {
        map.set(key, [entry]);
      }
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="list-panel">
      <div className="list-panel-header">
        <h3>History</h3>
        {entries.length > 0 && (
          <button className="list-clear-btn no-drag" onClick={onClear} title="Clear history">
            Clear
          </button>
        )}
      </div>
      <div className="list-items history-list">
        {entries.length === 0 && <div className="list-empty">No history yet.</div>}
        {groups.map(([day, items]) => (
          <div key={day} className="history-group">
            <div className="history-group-label">{day}</div>
            {items.map((entry, idx) => {
              const domain = domainFromUrl(entry.url);
              const rawTitle = entry.title?.trim() || "";
              const isTitleGeneric =
                !rawTitle || rawTitle.toLowerCase() === domain.toLowerCase() || rawTitle === entry.url;
              const displayTitle = isTitleGeneric ? domain : rawTitle;
              const showDomainRow = !isTitleGeneric && domain.toLowerCase() !== displayTitle.toLowerCase();
              const decodedUrl = displayUrl(entry.url);
              const dateTime = formatDateTime(entry.visitedAt);
              const initial = domain.charAt(0).toUpperCase() || "•";
              return (
                <button
                  key={`${entry.url}-${entry.visitedAt}-${idx}`}
                  className="history-row no-drag history-row--detailed"
                  onClick={() => onOpen(entry)}
                  title={`${displayTitle}\n${decodedUrl}\n${dateTime}`}
                >
                  <div className="history-icon" aria-hidden>
                    {initial}
                  </div>
                  <div className="history-entry-main">
                    <div className="history-title-row">
                      <span className="history-title" title={displayTitle}>
                        {displayTitle}
                      </span>
                      <span className="history-time" title={dateTime}>
                        {dateTime}
                      </span>
                    </div>
                    {showDomainRow && (
                      <span className="history-domain" title={domain}>
                        {domain}
                      </span>
                    )}
                    <span className="history-url" title={decodedUrl}>
                      {decodedUrl}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
