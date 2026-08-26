import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Loader2, ArrowLeft, LayoutGrid, List, Star, Lock, Circle, Trash2, Palette } from "lucide-react";
import { retrieveSecureSecret, storeSecureSecret } from "../../services/storage";
import { uid } from "../../utils/browser";

type ScratchNote = {
  id: string;
  title: string;
  content: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
};

const ACCENT_COLORS = [
  "var(--accent-a)",
  "var(--accent-b)",
  "var(--accent-c)",
  "var(--accent-a)",
  "var(--accent-b)",
  "var(--accent-c)",
];

const NOTE_COLORS: Array<{ name: string; value: string }> = [
  { name: "Default", value: "" },
  { name: "Orange", value: "#ff7a3d" },
  { name: "Yellow", value: "#ffd23d" },
  { name: "Teal", value: "#4ecdc4" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Blue", value: "#6e9bff" },
  { name: "Green", value: "#34d399" },
  { name: "Pink", value: "#f472b6" },
  { name: "Gray", value: "#6b7280" },
];

function formatGalleryDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatEditDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function NotesPanel() {
  const [notes, setNotes] = useState<ScratchNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "edit">("list");
  const [sortBy, setSortBy] = useState<"name" | "date">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);
  const hasLoadedRef = useRef(false);

  // Load
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const raw = await retrieveSecureSecret("scratchpad_notes");
        if (!active) return;
        if (raw === null || raw === "") {
          setNotes([]);
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const valid: ScratchNote[] = parsed
              .filter((n: any) => n && typeof n.id === "string" && typeof n.content === "string")
              .map((n: any) => ({
                id: n.id,
                title: typeof n.title === "string" ? n.title : "",
                content: n.content,
                color: typeof n.color === "string" ? n.color : undefined,
                createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
                updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
              }));
            setNotes(valid);
            return;
          }
        } catch {
          // legacy single note
        }
        const legacy = raw.trim();
        if (legacy) {
          const migrated: ScratchNote = {
            id: uid(),
            title: legacy.split("\n")[0].slice(0, 48) || "Imported note",
            content: legacy,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setNotes([migrated]);
        } else {
          setNotes([]);
        }
      } catch (err) {
        console.error("Error loading scratchpad notes:", err);
      } finally {
        if (active) {
          setLoading(false);
          hasLoadedRef.current = true;
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  // Persist — don't save empty notes (both title and content blank)
  useEffect(() => {
    if (loading || !hasLoadedRef.current) return;
    const t = setTimeout(() => {
      const toSave = notes.filter((n) => n.title.trim() || n.content.trim());
      void storeSecureSecret("scratchpad_notes", JSON.stringify(toSave)).catch((err) =>
        console.error("Error saving notes:", err),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [notes, loading]);

  // Close context menu on outside click / scroll / resize
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const sorted = useMemo(() => {
    const copy = [...notes];
    copy.sort((a, b) => {
      if (sortBy === "name") {
        const ta = (a.title || "Untitled").toLowerCase();
        const tb = (b.title || "Untitled").toLowerCase();
        const cmp = ta.localeCompare(tb);
        return sortOrder === "asc" ? cmp : -cmp;
      } else {
        return sortOrder === "asc" ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt;
      }
    });
    return copy;
  }, [notes, sortBy, sortOrder]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return notes.find((n) => n.id === selectedId) || null;
  }, [notes, selectedId]);

  const toggleSort = (field: "name" | "date") => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "name" ? "asc" : "desc");
    }
  };

  const handleCreate = () => {
    const n: ScratchNote = {
      id: uid(),
      title: "",
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setNotes((prev) => [n, ...prev]);
    setSelectedId(n.id);
    setView("edit");
  };

  const handleOpen = (id: string) => {
    setSelectedId(id);
    setView("edit");
  };

  const handleBack = () => {
    // If the current note is still completely empty, discard it (don't save)
    if (selected && !selected.title.trim() && !selected.content.trim()) {
      setNotes((prev) => prev.filter((n) => n.id !== selected.id));
      setSelectedId(null);
    }
    setView("list");
  };

  const handleTitleChange = (v: string) => {
    if (!selected) return;
    const now = Date.now();
    setNotes((prev) => prev.map((n) => (n.id === selected.id ? { ...n, title: v, updatedAt: now } : n)));
  };

  const handleContentChange = (v: string) => {
    if (!selected) return;
    const now = Date.now();
    let derived = selected.title;
    if (!derived.trim() && v.trim()) {
      const first = v.split("\n").find((l) => l.trim()) || "";
      if (first) derived = first.slice(0, 56);
    }
    setNotes((prev) => prev.map((n) => (n.id === selected.id ? { ...n, content: v, title: derived, updatedAt: now } : n)));
  };

  const handleDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    const preview = target ? target.title || target.content.slice(0, 30) || "this note" : "this note";
    if (!window.confirm(`Delete "${preview}"?`)) return;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) {
      setView("list");
      setSelectedId(null);
    }
    setContextMenu(null);
  };

  const handleDeleteCurrent = () => {
    if (!selected) return;
    handleDelete(selected.id);
  };

  const handleColorChange = (id: string, color: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, color: color || undefined, updatedAt: Date.now() } : n)));
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep inside viewport
    const x = Math.min(e.clientX, window.innerWidth - 190);
    const y = Math.min(e.clientY, window.innerHeight - 260);
    setContextMenu({ x, y, noteId });
  };

  if (loading) {
    return (
      <div className="notes-panel notes-panel--gallery" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: "#717b99" }}>
          <Loader2 className="animate-spin" size={24} />
          <span style={{ fontSize: "12px" }}>Decrypting notes...</span>
        </div>
      </div>
    );
  }

  // ── Edit view — focused single note (pic 2) ──
  if (view === "edit" && selected) {
    const dotColor =
      selected.color || ACCENT_COLORS[notes.findIndex((n) => n.id === selected.id) % ACCENT_COLORS.length] || "var(--accent-a)";
    return (
      <div className="notes-panel notes-panel--edit">
        <div className="notes-edit-topbar">
          <button className="notes-back-btn no-drag" onClick={handleBack} aria-label="Back to notes">
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
          <div className="notes-edit-actions">
            <span className="notes-edit-dot" style={{ background: dotColor }} />
            <button className="notes-edit-icon-btn no-drag" title="Favorite">
              <Star size={16} strokeWidth={1.8} />
            </button>
            <button className="notes-edit-icon-btn no-drag" onClick={handleDeleteCurrent} title="Delete">
              <Lock size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="notes-edit-date">{formatEditDate(selected.updatedAt)}</div>

        <textarea
          className="notes-edit-title no-drag"
          value={selected.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Beautiful notes app UI concepts..."
          rows={2}
        />

        <textarea
          className="notes-edit-content no-drag"
          value={selected.content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Start writing your note here..."
          spellCheck={false}
        />
      </div>
    );
  }

  // ── List view — grid / list with sort (pic 1) ──
  return (
    <div className="notes-panel notes-panel--gallery">
      <div className="notes-gallery-topbar no-drag">
        <div className="notes-sort-pills">
          <button
            className={`sort-pill ${sortBy === "name" ? "active" : ""}`}
            onClick={() => toggleSort("name")}
          >
            Name <span className="sort-arrow">{sortBy === "name" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}</span>
          </button>
          <button
            className={`sort-pill ${sortBy === "date" ? "active orange" : ""}`}
            onClick={() => toggleSort("date")}
          >
            Date <span className="sort-arrow">{sortBy === "date" ? (sortOrder === "asc" ? "↑" : "↓") : "↓"}</span>
          </button>
        </div>
        <button className="view-toggle no-drag" onClick={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))} title="Toggle view">
          {viewMode === "grid" ? "Grid" : "List"} {viewMode === "grid" ? <LayoutGrid size={12} /> : <List size={12} />}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="notes-gallery-empty">
          <div className="notes-gallery-empty-icon">
            <Circle size={28} style={{ opacity: 0.35 }} />
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>No notes yet</span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "200px", textAlign: "center" }}>
            Tap the + button to create your first beautiful note.
          </span>
        </div>
      ) : (
        <div className={`notes-gallery ${viewMode}`}>
          {sorted.map((n, idx) => {
            const accent = n.color || ACCENT_COLORS[idx % ACCENT_COLORS.length];
            const title = n.title.trim() || "Beautiful notes app UI concepts...";
            const preview =
              n.content.trim().replace(/\n/g, " ").slice(0, 110) ||
              "Torem ipsum dolor sit amet, consectetur adipiscing elit. Nunc vulputate libero et velit interdum, ac aliquet odi...";
            return (
              <button
                key={n.id}
                className="note-gallery-card no-drag"
                style={{ borderBottomColor: accent } as React.CSSProperties}
                onClick={() => handleOpen(n.id)}
                onContextMenu={(e) => handleContextMenu(e, n.id)}
                title={`${title}\n${preview}\nRight-click for options`}
              >
                <div className="gallery-card-title">{title}</div>
                <div className="gallery-card-preview">{preview}</div>
                <div className="gallery-card-date">{formatGalleryDate(n.updatedAt)}</div>
              </button>
            );
          })}
        </div>
      )}

      <button className="notes-fab no-drag" onClick={handleCreate} aria-label="New note">
        <Plus size={22} strokeWidth={2.5} />
      </button>

      {contextMenu && (
        <div
          className="notes-context-menu no-drag"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="notes-ctx-item danger"
            onClick={() => handleDelete(contextMenu.noteId)}
          >
            <Trash2 size={12} /> Delete
          </button>
          <div className="notes-ctx-divider" />
          <div className="notes-ctx-label">
            <Palette size={11} /> Change color
          </div>
          <div className="notes-ctx-colors">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.name}
                className="notes-ctx-color"
                style={{ background: c.value || "var(--bg-hover)", borderColor: c.value ? "transparent" : "var(--border-subtle)" }}
                title={c.name}
                onClick={() => handleColorChange(contextMenu.noteId, c.value)}
              >
                {!c.value && <span style={{ fontSize: "8px", color: "var(--text-muted)" }}>✕</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
