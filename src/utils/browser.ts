import type { Tab, SearchEngine, Settings, TabGroup, Workspace } from "../types";

export const HOME_TAB_ID = "home";
export const STORAGE_KEY_TABS = "silentx-tabs-v1";
export const STORAGE_KEY_SETTINGS = "silentx-settings-v1";
export const STORAGE_KEY_BOOKMARKS = "silentx-bookmarks-v1";
export const STORAGE_KEY_HISTORY = "silentx-history-v1";
export const STORAGE_KEY_DOWNLOADS = "silentx-downloads-v1";
export const STORAGE_KEY_GROUPS = "silentx-groups-v1";
export const STORAGE_KEY_WORKSPACES = "silentx-workspaces-v1";
export const STORAGE_KEY_ACTIVE_WORKSPACE = "silentx-active-workspace-v1";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  searchEngine: "duckduckgo",
  homeGreeting: "Sviatoslav",
  startupBehavior: "previous",
  defaultDownloadsPath: "Downloads",
  adBlockingEnabled: false,
};

export const GROUP_COLORS = [
  { name: "Blue", value: "#6e9bff" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Cyan", value: "#7de3ff" },
  { name: "Emerald", value: "#34d399" },
  { name: "Amber", value: "#fbbf24" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Slate", value: "#94a3b8" },
];

export const DEFAULT_WORKSPACES: Workspace[] = [
  { id: "personal", name: "Personal", icon: "user", color: "#6e9bff" },
  { id: "development", name: "Development", icon: "code", color: "#a78bfa" },
  { id: "cybersecurity", name: "Cybersecurity", icon: "shield", color: "#34d399" },
];

export const DEFAULT_GROUPS: Record<string, TabGroup> = {
  essentials: {
    id: "essentials",
    name: "Essentials",
    color: "#6e9bff",
    collapsed: true,
    workspaceId: "personal",
  },
};

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}

export function normalizeInput(input: string, searchEngine: SearchEngine = "duckduckgo"): string {
  const value = input.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(value) || value.startsWith("localhost")) {
    return `https://${value}`;
  }
  switch (searchEngine) {
    case "google":
      return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
    case "bing":
      return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
    case "duckduckgo":
    default:
      return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  }
}

/** Strip protocol, www and trailing slash for URL comparison. */
export function normalizeUrl(url: string): string {
  let normalized = url.toLowerCase();
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  normalized = normalized.replace(/^https?:\/\/(www\.)?/, "");
  return normalized;
}

export function makeHomeTab(workspaceId = "personal"): Tab {
  return {
    id: `${HOME_TAB_ID}-${workspaceId}-${uid()}`,
    kind: "home",
    title: "New tab",
    url: "",
    label: `silentx-home-${workspaceId}`,
    history: [],
    index: -1,
    workspaceId,
  };
}

export function makeWebTab(url: string, title?: string, group?: string, workspaceId = "personal"): Tab {
  const id = uid();
  return {
    id,
    kind: "web",
    title: title ?? titleFromUrl(url),
    url,
    label: `silentx-tab-${id}`,
    history: [url],
    index: 0,
    group,
    workspaceId,
  };
}

export function defaultTabs(): Tab[] {
  const essentials = (url: string, title: string): Tab => ({
    ...makeWebTab(url, title, "essentials", "personal"),
    group: "essentials",
  });
  return [
    // Personal Workspace tabs
    essentials("https://www.youtube.com", "YouTube"),
    essentials("https://notion.so", "Notion"),
    essentials("https://mail.google.com", "Gmail"),
    makeWebTab("https://dribbble.com", "Dribbble", undefined, "personal"),
    makeHomeTab("personal"),

    // Development Workspace tabs
    makeWebTab("https://github.com", "GitHub", undefined, "development"),
    makeWebTab("https://stackoverflow.com", "Stack Overflow", undefined, "development"),

    // Cybersecurity Workspace tabs
    makeWebTab("https://www.shodan.io", "Shodan", undefined, "cybersecurity"),
    makeWebTab("https://www.exploit-db.com", "Exploit Database", undefined, "cybersecurity"),
  ];
}
