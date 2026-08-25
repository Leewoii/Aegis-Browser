import type { Bookmark, DownloadEntry, HistoryEntry, PanelId, Settings } from "../../types";
import { isWebAppPanel, PANEL_TITLES } from "../../types";
import { BookmarksPanel } from "./BookmarksPanel";
import { HistoryPanel } from "./HistoryPanel";
import { DownloadsPanel } from "./DownloadsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { NotesPanel } from "./NotesPanel";

interface PanelHostProps {
  activePanel: PanelId;
  panelContentRef: React.Ref<HTMLDivElement>;
  bookmarks: Bookmark[];
  onAddBookmark: (title: string, url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  historyEntries: HistoryEntry[];
  onClearHistory: () => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  downloads: DownloadEntry[];
  onPauseDownload?: (id: string) => void;
  onResumeDownload?: (id: string) => void;
  onCancelDownload?: (id: string) => void;
  onRetryDownload?: (id: string) => void;
  onDeleteDownload?: (id: string) => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  activeWorkspaceId: string;
  onClearDownloads: () => void;
  onClearProfileData: (profileKey: string) => Promise<void>;
}

export function PanelHeader({ panel }: { panel: PanelId }) {
  return (
    <div className="panel-header">
      <span className="panel-title">{PANEL_TITLES[panel]}</span>
    </div>
  );
}

export function PanelContent(props: PanelHostProps) {
  const { activePanel } = props;

  if (isWebAppPanel(activePanel)) {
    return <div className="panel-webview-container" ref={props.panelContentRef} />;
  }

  switch (activePanel) {
    case "bookmarks":
      return (
        <BookmarksPanel
          bookmarks={props.bookmarks}
          onAdd={props.onAddBookmark}
          onRemove={props.onRemoveBookmark}
          onOpen={props.onOpenBookmark}
        />
      );
    case "history":
      return (
        <HistoryPanel
          entries={props.historyEntries}
          onClear={props.onClearHistory}
          onOpen={props.onOpenHistoryEntry}
        />
      );
    case "downloads":
      return (
        <DownloadsPanel
          downloads={props.downloads}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
          onRetry={props.onRetryDownload}
          onDelete={props.onDeleteDownload}
        />
      );
    case "settings":
      return (
        <SettingsPanel
          settings={props.settings}
          onChange={props.onSettingsChange}
          activeWorkspaceId={props.activeWorkspaceId}
          onClearHistory={props.onClearHistory}
          onClearDownloads={props.onClearDownloads}
          onClearProfileData={props.onClearProfileData}
        />
      );
    case "notes":
      return <NotesPanel />;
    default:
      return <div className="panel-empty">No panel selected</div>;
  }
}
