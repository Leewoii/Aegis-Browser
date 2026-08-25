import { useMemo } from "react";
import type { HistoryEntry } from "../../types";
import { formatDayGroup, formatTime } from "../../utils/format";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
  onOpen: (entry: HistoryEntry) => void;
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
      <div className="list-items">
        {entries.length === 0 && <div className="list-empty">No history yet.</div>}
        {groups.map(([day, items]) => (
          <div key={day} className="history-group">
            <div className="history-group-label">{day}</div>
            {items.map((entry, idx) => (
              <button
                key={`${entry.visitedAt}-${idx}`}
                className="history-row no-drag"
                onClick={() => onOpen(entry)}
              >
                <span className="history-time">{formatTime(entry.visitedAt)}</span>
                <span className="history-title">{entry.title || entry.url}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
