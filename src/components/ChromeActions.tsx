import {
  Bookmark as BookmarkIcon,
  Download as DownloadIcon,
  PanelLeft,
  Plus,
} from "lucide-react";
import type { PanelId } from "../types";

interface ChromeActionsProps {
  activePanel: PanelId | null;
  onTogglePanel: (panel: PanelId) => void;
  onNewTab: () => void;
  isSidebarPinned: boolean;
  onToggleSidebarPin: () => void;
}

export function ChromeActions({
  activePanel,
  onTogglePanel,
  onNewTab,
  isSidebarPinned,
  onToggleSidebarPin,
}: ChromeActionsProps) {
  return (
    <div className="chrome-actions no-drag">
      <button
        className={`chrome-action-btn ${activePanel === "bookmarks" ? "active" : ""}`}
        onClick={() => onTogglePanel("bookmarks")}
        title="Bookmarks"
      >
        <BookmarkIcon size={14} strokeWidth={1.8} />
      </button>

      <button
        className={`chrome-action-btn ${activePanel === "downloads" ? "active" : ""}`}
        onClick={() => onTogglePanel("downloads")}
        title="Downloads"
      >
        <DownloadIcon size={14} strokeWidth={1.8} />
      </button>

      <button className="chrome-action-btn" onClick={onNewTab} title="New tab (Ctrl+T)">
        <Plus size={15} strokeWidth={1.8} />
      </button>

      <button
        className={`chrome-action-btn ${isSidebarPinned ? "active" : ""}`}
        onClick={onToggleSidebarPin}
        title={isSidebarPinned ? "Collapse sidebar" : "Pin sidebar"}
      >
        <PanelLeft size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
