import { WEB_APP_PANELS } from "./constants/webApps";

export type TabKind = "home" | "web" | "updates";

export type Tab = {
  id: string;
  kind: TabKind;
  title: string;
  url: string;
  label: string;
  history: string[];
  index: number;
  /** Tabs sharing a group id render as one compact grouped chip in the tab bar. */
  group?: string;
  /** The workspace this tab belongs to (default 'personal'). */
  workspaceId?: string;
  pinned?: boolean;
  muted?: boolean;
  createdAt?: number;
  lastAccessedAt?: number;
};

export type TabGroup = {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
  workspaceId?: string;
};

export type Workspace = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
};

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  createdAt: number;
};

export type HistoryEntry = {
  url: string;
  title: string;
  visitedAt: number;
  visitCount?: number;
  transitionType?: "link" | "typed" | "auto_bookmark" | "redirect";
};

export type DownloadState = "completed" | "in_progress" | "paused" | "failed" | "cancelled";

export type DownloadEntry = {
  id: string;
  filename: string;
  url: string;
  destination?: string;
  totalBytes: number;
  receivedBytes: number;
  completed: boolean;
  state?: DownloadState;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
};

export type SidebarState = {
  isSidebarPinned: boolean;
  activePanel: PanelId | null;
  isPanelPinned: boolean;
  panelWidth: number;
  mutedPanels: string[];
};

export type ClosedTab = {
  id: string;
  workspaceId: string;
  title: string;
  url: string;
  tabData: Tab;
  closedAt: number;
};

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
};

export type SearchEngine = "duckduckgo" | "google" | "bing";

export type ThemeName = "dark" | "amoled" | "nord";

export type Settings = {
  theme: ThemeName;
  searchEngine: SearchEngine;
  homeGreeting: string;
  startupBehavior: "home" | "previous";
  defaultDownloadsPath: string;
  adBlockingEnabled: boolean;
};

export type ToastType = "info" | "error" | "success";

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

export type PanelId =
  | "bookmarks"
  | "downloads"
  | "history"
  | "settings"
  | "chatgpt"
  | "twitch"
  | "messenger"
  | "whatsapp"
  | "spotify"
  | "notes"
  | "workspaces";

export const isWebAppPanel = (panel: PanelId): boolean => panel in WEB_APP_PANELS;

export const PANEL_TITLES: Record<PanelId, string> = {
  bookmarks: "Bookmarks",
  downloads: "Downloads",
  history: "History",
  settings: "Settings",
  chatgpt: "ChatGPT",
  twitch: "Twitch",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  spotify: "Spotify",
  notes: "Scratchpad",
  workspaces: "Workspaces",
};
