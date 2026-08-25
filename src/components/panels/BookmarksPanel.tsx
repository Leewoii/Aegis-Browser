import { useState } from "react";
import { Globe, Plus, X } from "lucide-react";
import type { Bookmark } from "../../types";

interface BookmarksPanelProps {
  bookmarks: Bookmark[];
  onAdd: (title: string, url: string) => void;
  onRemove: (id: string) => void;
  onOpen: (bookmark: Bookmark) => void;
}

export function BookmarksPanel({ bookmarks, onAdd, onRemove, onOpen }: BookmarksPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [input, setInput] = useState({ title: "", url: "" });

  function submit() {
    if (!input.title.trim() || !input.url.trim()) return;
    onAdd(input.title.trim(), input.url.trim());
    setInput({ title: "", url: "" });
    setShowForm(false);
  }

  return (
    <div className="list-panel">
      <div className="list-panel-header">
        <h3>Bookmarks</h3>
        <button className="list-add-btn no-drag" onClick={() => setShowForm(!showForm)} title="Add bookmark">
          <Plus size={14} />
        </button>
      </div>

      {showForm && (
        <div className="add-bookmark-form">
          <input
            placeholder="Title"
            value={input.title}
            onChange={(e) => setInput((prev) => ({ ...prev, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
          <input
            placeholder="URL"
            value={input.url}
            onChange={(e) => setInput((prev) => ({ ...prev, url: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button className="add-btn no-drag" onClick={submit}>
            Add
          </button>
        </div>
      )}

      <div className="list-items">
        {bookmarks.length === 0 && (
          <div className="list-empty">No bookmarks yet. Click + to add one.</div>
        )}
        {bookmarks.map((bm) => (
          <div key={bm.id} className="list-item-row">
            <a
              className="list-item"
              href={bm.url}
              onClick={(e) => {
                e.preventDefault();
                onOpen(bm);
              }}
            >
              <Globe size={14} />
              <span className="list-item-title">{bm.title}</span>
            </a>
            <button
              className="list-item-remove no-drag"
              onClick={() => onRemove(bm.id)}
              title="Remove bookmark"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
