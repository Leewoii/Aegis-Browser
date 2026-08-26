import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Upload,
  Volume2,
  VolumeX,
  Pin,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

import type {
  Bookmark,
  HistoryEntry,
  DownloadEntry,
  PanelId,
  Settings,
  Tab,
  TabGroup,
  Workspace,
} from "./types";
import { isWebAppPanel } from "./types";
import {
  HOME_TAB_ID,
  DEFAULT_SETTINGS,
  DEFAULT_GROUPS,
  DEFAULT_WORKSPACES,
  defaultTabs,
  makeHomeTab,
  makeUpdatesTab,
  makeConsoleTab,
  makeWebTab,
  normalizeInput,
  titleFromUrl,
  uid,
} from "./utils/browser";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import {
  initializeStorage,
  loadTabs,
  loadSettings,
  loadBookmarks,
  loadHistory,
  loadDownloads,
  loadGroups,
  loadWorkspaces,
  loadActiveWorkspace,
  loadSidebarState,
  saveSidebarState,
  loadWindowState,
  saveWindowState,
  recordClosedTab,
  saveTabs,
  saveSettings,
  saveBookmarks,
  saveHistory,
  saveDownloads,
  saveGroups,
  saveWorkspaces,
  saveActiveWorkspace,
  appendHistory,
  clearHistory as clearHistoryDb,
} from "./services/storage";
import { downloadManager } from "./services/downloads";

import { TabStrip } from "./components/TabStrip";
import { ChromeActions } from "./components/ChromeActions";
import { Omnibox, useSuggestions } from "./components/Omnibox";
import { HomeScreen } from "./components/HomeScreen";
import { UpdatesScreen } from "./components/UpdatesScreen";
import { DevConsoleScreen } from "./components/DevConsoleScreen";
import { devConsole } from "./services/devConsole";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { PanelContent } from "./components/panels/PanelHost";
import { CreateWorkspaceModal } from "./components/CreateWorkspaceModal";
import type { ContextMenuData } from "./components/ContextMenu";
import { SplitViewport } from "./components/SplitViewport";
import { SplitDropOverlay } from "./components/SplitDropOverlay";
import type { SplitSide } from "./components/SplitDropOverlay";
import type { SplitViewState } from "./types";
import type { SplitActiveTabs } from "./hooks/useWebviewManager";

import { useToasts } from "./hooks/useToasts";
import { useVoiceSearch } from "./hooks/useVoiceSearch";
import { useQrScan } from "./hooks/useQrScan";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWebviewManager } from "./hooks/useWebviewManager";
import { debugLog } from "./services/debug";

export default function App() {
  // ── Core browser state ────────────────────────────────────────────
  const [tabs, setTabs] = useState<Tab[]>(defaultTabs);
  const [tabGroups, setTabGroups] = useState<Record<string, TabGroup>>(DEFAULT_GROUPS);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("personal");
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const tabHistoryRef = useRef<string[]>([HOME_TAB_ID]);

  useEffect(() => {
    tabHistoryRef.current = [activeTabId, ...tabHistoryRef.current.filter((id) => id !== activeTabId)].slice(0, 50);
  }, [activeTabId]);

  // ── Split screen state ────────────────────────────────────────────
  const [splitState, setSplitState] = useState<SplitViewState | null>(null);
  const [splitDragSide, setSplitDragSide] = useState<SplitSide>(null);
  const splitStateRef = useRef<SplitViewState | null>(null);
  const splitLeftRef  = useRef<HTMLDivElement | null>(null);
  const splitRightRef = useRef<HTMLDivElement | null>(null);
  /** Updated every render so the webview manager closure always reads the latest */
  splitStateRef.current = splitState;

  // ── Sidebar & Side panel state ────────────────────────────────────
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const isSidebarHoveredRef = useRef(false);
  isSidebarHoveredRef.current = isSidebarHovered;
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [isPanelPinned, setIsPanelPinned] = useState(false);
  const [mutedPanels, setMutedPanels] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(340);
  const [isResizing, setIsResizing] = useState(false);
  const panelWidthRef = useRef(340);

  // ── Refs ──────────────────────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement | null>(null);
  const panelContentRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const sidebarShellRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef<Tab | null>(null);
  const activePanelRef = useRef<PanelId | null>(null);
  const isPanelPinnedRef = useRef(isPanelPinned);
  const isSidebarPinnedRef = useRef(isSidebarPinned);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const isClosingRef = useRef(false);
  const storageLoadedRef = useRef(false);

  const { toasts, showToast, dismissToast } = useToasts();

  // ── Workspaces & Filtered Tabs ────────────────────────────────────

  const visibleTabs = useMemo(() => {
    const filtered = tabs.filter((t) => {
      const g = t.group ? tabGroups[t.group] : undefined;
      const wsId = t.workspaceId || g?.workspaceId || "personal";
      return wsId === activeWorkspaceId;
    });
    return filtered.length > 0 ? filtered : [makeHomeTab(activeWorkspaceId)];
  }, [tabs, tabGroups, activeWorkspaceId]);

  const activeTab = useMemo(() => {
    const current = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0] ?? makeHomeTab(activeWorkspaceId);
    return current;
  }, [visibleTabs, activeTabId, activeWorkspaceId]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    isPanelPinnedRef.current = isPanelPinned;
  }, [isPanelPinned]);

  useEffect(() => {
    isSidebarPinnedRef.current = isSidebarPinned;
  }, [isSidebarPinned]);

  // Tab counts per workspace
  const workspaceTabCounts = useMemo(() => {
    const counts: Record<string, number> = { personal: 0, development: 0, cybersecurity: 0 };
    for (const tab of tabs) {
      const gId = tab.group;
      const g = gId ? tabGroups[gId] : undefined;
      const wsId = tab.workspaceId || g?.workspaceId || "personal";
      counts[wsId] = (counts[wsId] || 0) + 1;
    }
    return counts;
  }, [tabs, tabGroups]);

  // ── Prevent native context menu on HTML background ────────────────
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // ── Track mouse over sidebar/panel region ─────────────────────────
  const isMouseOverPanelOrSidebarRef = useRef(false);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) {
        isMouseOverPanelOrSidebarRef.current = false;
        return;
      }
      const inSidePanel = Boolean(sidePanelRef.current && (sidePanelRef.current === target || sidePanelRef.current.contains(target)));
      const inSidebar = Boolean(sidebarShellRef.current && (sidebarShellRef.current === target || sidebarShellRef.current.contains(target)));
      const el = target instanceof Element ? target : target.parentElement;
      const inClosest = Boolean(el && (el.closest(".side-panel") || el.closest(".sidebar-shell")));
      isMouseOverPanelOrSidebarRef.current = inSidePanel || inSidebar || inClosest;
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
    };
  }, []);

  // ── Unpinned side panel click-outside & blur detection ─────────────
  useEffect(() => {
    if (!activePanel || isPanelPinned) return;

    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // 1. If clicked inside the side panel itself, keep open
      if (sidePanelRef.current && (sidePanelRef.current === target || sidePanelRef.current.contains(target))) {
        return;
      }
      // 2. If clicked inside the sidebar, keep open (sidebar buttons handle their own toggle/switching)
      if (sidebarShellRef.current && (sidebarShellRef.current === target || sidebarShellRef.current.contains(target))) {
        return;
      }
      // 3. Fallback: check DOM tree for .side-panel or .sidebar-shell in case target is a sub-element
      const el = target instanceof Element ? target : target.parentElement;
      if (el && (el.closest(".side-panel") || el.closest(".sidebar-shell"))) {
        return;
      }

      // Clicked outside both sidebar and side panel -> auto-hide unpinned panel
      setActivePanel(null);
    };

    const handleWindowBlur = () => {
      // If mouse is inside the side panel (e.g. user clicked inside an embedded web app webview), keep open
      if (isMouseOverPanelOrSidebarRef.current) return;
      // Otherwise, focus transferred to the browsing webview or outside the window -> auto-hide unpinned panel
      setActivePanel(null);
    };

    window.addEventListener("pointerdown", handlePointerDownOutside, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [activePanel, isPanelPinned]);

  // ── Auto-hide unpinned sidebar on outside click/hover/blur ─────────
  useEffect(() => {
    if (isSidebarPinned) {
      setIsSidebarHovered(false);
      return;
    }

    const handlePointerMoveOutside = (e: PointerEvent) => {
      if (!isSidebarHoveredRef.current) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (sidebarShellRef.current && (sidebarShellRef.current === target || sidebarShellRef.current.contains(target))) {
        return;
      }
      const el = target instanceof Element ? target : target.parentElement;
      if (el && el.closest(".sidebar-shell")) {
        return;
      }
      setIsSidebarHovered(false);
    };

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (!isSidebarHoveredRef.current) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (sidebarShellRef.current && (sidebarShellRef.current === target || sidebarShellRef.current.contains(target))) {
        return;
      }
      const el = target instanceof Element ? target : target.parentElement;
      if (el && el.closest(".sidebar-shell")) {
        return;
      }
      setIsSidebarHovered(false);
    };

    const handleWindowBlur = () => {
      setIsSidebarHovered(false);
    };

    window.addEventListener("pointermove", handlePointerMoveOutside, true);
    window.addEventListener("pointerdown", handlePointerDownOutside, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMoveOutside, true);
      window.removeEventListener("pointerdown", handlePointerDownOutside, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isSidebarPinned]);

  const isOverlayActive = Boolean(query.trim() || isCreateWorkspaceOpen);
  const isOverlayActiveRef = useRef(isOverlayActive);
  isOverlayActiveRef.current = isOverlayActive;

  // ── Webview manager ───────────────────────────────────────────────
  const {
    destroyTabWebview,
    recreateTabWebview,
    syncActive,
    scheduleSyncActive,
    syncPanelOnly,
    hideActiveWebview,
  } = useWebviewManager({
    contentRef,
    splitLeftRef,
    splitRightRef,
    panelContentRef,
    getActiveTab: () => activeTabRef.current,
    getSplitTabs: (): SplitActiveTabs => {
      const s = splitStateRef.current;
      if (!s) return null;
      const curId = activeTabRef.current?.id;
      if (curId !== s.leftTabId && curId !== s.rightTabId) {
        return null;
      }
      const leftTab  = tabsRef.current.find((t) => t.id === s.leftTabId)  ?? null;
      const rightTab = tabsRef.current.find((t) => t.id === s.rightTabId) ?? null;
      if (!leftTab || !rightTab) return null;
      return { left: leftTab, right: rightTab, ratio: s.ratio };
    },
    activePanelRef,
    isOverlayActiveRef,
    showToast,
  });

  // ── Persistence ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      devConsole.initGlobalInterceptors();
      devConsole.persistence({
        entity: "session",
        state: "persisting",
        stage: "reload_refetch",
        action: "APP_STARTUP_LOAD",
        description: "Initializing SQLite storage and loading user profile...",
      });
      await initializeStorage();
      if (cancelled) return;
      const [
        tabsData,
        settingsData,
        bookmarksData,
        historyData,
        downloadsData,
        groupsData,
        workspacesData,
        wsIdData,
        sidebarData,
        savedWindow,
      ] = await Promise.all([
        loadTabs(),
        loadSettings(),
        loadBookmarks(),
        loadHistory(),
        loadDownloads(),
        loadGroups(),
        loadWorkspaces(),
        loadActiveWorkspace(),
        loadSidebarState(),
        loadWindowState(),
      ]);
      if (cancelled) return;

      devConsole.persistence({
        entity: "session",
        state: "db_committed",
        stage: "persisted_data",
        action: "APP_STARTUP_LOAD",
        description: `Successfully loaded ${tabsData.tabs.length} tabs, ${workspacesData.length} workspaces, ${bookmarksData.length} bookmarks from SQLite.`,
        details: {
          tabsCount: tabsData.tabs.length,
          workspacesCount: workspacesData.length,
          bookmarksCount: bookmarksData.length,
          activeWorkspace: wsIdData,
        },
      });
      setSettings(settingsData);
      const startBehavior = settingsData.startupBehavior || "previous";
      if (startBehavior === "home") {
        const activeWs = wsIdData || "personal";
        const initialHomeTab = makeHomeTab(activeWs);
        setTabs([initialHomeTab]);
        setActiveTabId(initialHomeTab.id);
      } else {
        setTabs(tabsData.tabs.length ? tabsData.tabs : defaultTabs());
        setActiveTabId(tabsData.activeTabId);
      }
      setBookmarks(bookmarksData);
      setHistoryEntries(historyData);
      setDownloads(downloadsData);
      downloadManager.setDownloads(downloadsData);
      // Automatically resume paused or interrupted downloads from previous sessions
      downloadManager.autoResumePending();
      if (Object.keys(groupsData).length) setTabGroups(groupsData);
      if (workspacesData.length) setWorkspaces(workspacesData);
      if (wsIdData) setActiveWorkspaceId(wsIdData);
      if (sidebarData) {
        setIsSidebarPinned(sidebarData.isSidebarPinned);
        setIsPanelPinned(sidebarData.isPanelPinned);
        setActivePanel(sidebarData.activePanel);
        setPanelWidth(sidebarData.panelWidth || 340);
        if (sidebarData.mutedPanels.length) {
          setMutedPanels(new Set(sidebarData.mutedPanels));
        }
      }
      if (savedWindow) {
        try {
          const appWindow = getCurrentWindow();
          if (savedWindow.isMaximized) {
            await appWindow.maximize();
          } else {
            if (savedWindow.width > 300 && savedWindow.height > 200) {
              await appWindow.setSize(new LogicalSize(savedWindow.width, savedWindow.height));
            }
            if (
              typeof savedWindow.x === "number" &&
              typeof savedWindow.y === "number" &&
              savedWindow.x >= 0 &&
              savedWindow.y >= 0
            ) {
              await appWindow.setPosition(new LogicalPosition(savedWindow.x, savedWindow.y));
            }
          }
        } catch {
          // ignore
        }
      }
      // #region DEBUG
      await debugLog(
        `[DEBUG H1] load complete tabs=${tabsData.tabs.length} activeTabId=${tabsData.activeTabId} startBehavior=${settingsData.startupBehavior || "previous"} ws=${wsIdData || "personal"}`,
      );
      // #endregion DEBUG
      storageLoadedRef.current = true;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Reactive download manager subscription ─────────────────────────
  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((dls) => {
      setDownloads(dls);
    });
    return unsubscribe;
  }, []);

  // ── Window State Persistence ───────────────────────────────────────
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const saveCurrentWindowState = async () => {
      if (!storageLoadedRef.current) return;
      try {
        const appWindow = getCurrentWindow();
        const isMaximized = await appWindow.isMaximized();
        if (isMaximized) {
          await saveWindowState({ width: 1440, height: 920, isMaximized: true });
        } else {
          const size = await appWindow.innerSize();
          const pos = await appWindow.outerPosition();
          await saveWindowState({
            width: size.width,
            height: size.height,
            x: pos.x,
            y: pos.y,
            isMaximized: false,
          });
        }
      } catch {
        // ignore
      }
    };

    const handleWindowChange = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(saveCurrentWindowState, 600);
    };

    window.addEventListener("resize", handleWindowChange);
    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("resize", handleWindowChange);
    };
  }, []);

  useEffect(() => {
    if (!storageLoadedRef.current || isClosingRef.current) return;
    const timeout = setTimeout(() => {
      if (!isClosingRef.current) void saveTabs(tabs, activeTabId);
    }, 200);
    return () => clearTimeout(timeout);
  }, [tabs, activeTabId]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveGroups(tabGroups);
  }, [tabGroups]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveWorkspaces(workspaces);
  }, [workspaces]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveActiveWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveHistory(historyEntries);
  }, [historyEntries]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) void saveDownloads(downloads);
  }, [downloads]);

  useEffect(() => {
    if (storageLoadedRef.current && !isClosingRef.current) {
      void saveSidebarState({
        isSidebarPinned,
        activePanel: isPanelPinned ? activePanel : null,
        isPanelPinned,
        panelWidth,
        mutedPanels: Array.from(mutedPanels),
      });
    }
  }, [isSidebarPinned, isPanelPinned, activePanel, panelWidth, mutedPanels]);

  useEffect(() => {
    let disposed = false;
    let unlistenClose: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (isClosingRef.current) return;
        event.preventDefault();
        isClosingRef.current = true;

        // #region DEBUG
        await debugLog(
          `[DEBUG H1] close requested tabs=${tabsRef.current.length} activeTabId=${activeTabIdRef.current} activeTab=${activeTabRef.current?.id ?? "none"} ws=${activeWorkspaceId}`,
        );
        // #endregion DEBUG

        try {
          await saveTabs(tabsRef.current, activeTabIdRef.current);
        } catch (error) {
          // #region DEBUG
          await debugLog(`[DEBUG H1] flush saveTabs failed: ${error instanceof Error ? error.message : String(error)}`);
          // #endregion DEBUG
          console.error("Failed to flush tabs before close:", error);
        }

        try {
          await getCurrentWindow().close();
        } catch (error) {
          // #region DEBUG
          await debugLog(`[DEBUG H1] close finalizer failed: ${error instanceof Error ? error.message : String(error)}`);
          // #endregion DEBUG
          console.error("Failed to close window after flush:", error);
        }
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlistenClose = cleanup;
        }
      });

    return () => {
      disposed = true;
      unlistenClose?.();
    };
  }, []);

  // Keep active tab valid within visible tabs
  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(visibleTabs[0]?.id ?? makeHomeTab(activeWorkspaceId).id);
    }
  }, [visibleTabs, activeTabId, activeWorkspaceId]);

  // ── Native events ─────────────────────────────────────────────────

  function createWebTab(url: string, title?: string, group?: string) {
    const tab = makeWebTab(url, title, group, activeWorkspaceId);
    setTabs((current) => [
      ...current.filter((item) => item.id !== activeTab.id || item.kind !== "home"),
      tab,
    ]);
    setActiveTabId(tab.id);
    recordHistory(url, title || titleFromUrl(url));
  }

  const createWebTabRef = useRef(createWebTab);
  createWebTabRef.current = createWebTab;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<string>("Aegis-open-link", (event) => {
      const url = event.payload;
      if (typeof url !== "string" || !url.trim()) return;
      createWebTabRef.current(url, titleFromUrl(url));
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    void listen<string>("Aegis-tab-pointerdown", () => {
      if (!disposed) {
        if (!isPanelPinnedRef.current) {
          setActivePanel(null);
        }
        if (!isSidebarPinnedRef.current) {
          setIsSidebarHovered(false);
        }
      }
    }).then((fn) => (disposed ? fn() : cleanups.push(fn)));

    void listen<string>("Aegis-page-load-started", () => {
      if (!disposed) setIsLoading(true);
    }).then((fn) => (disposed ? fn() : cleanups.push(fn)));

    void listen<{ label?: string; url?: string } | string>("Aegis-page-load-finished", (event) => {
      if (!disposed) {
        setIsLoading(false);
        const payload = event.payload;
        const url = typeof payload === "string" ? payload : payload?.url;
        const label = typeof payload === "object" && payload !== null ? payload.label : undefined;
        if (url && url !== "about:blank") {
          setTabs((prev) =>
            prev.map((tab) => {
              const matches = label ? tab.label === label : tab.id === activeTabRef.current?.id;
              if (matches && tab.url !== url) {
                const history = tab.history.slice(0, tab.index);
                history.push(url);
                return {
                  ...tab,
                  url,
                  title: titleFromUrl(url),
                  history,
                  index: history.length - 1,
                };
              }
              return tab;
            }),
          );
        }
      }
    }).then((fn) => (disposed ? fn() : cleanups.push(fn)));

    return () => {
      disposed = true;
      for (const fn of cleanups) fn();
    };
  }, []);

  // ── Webview sync effects ──────────────────────────────────────────

  useEffect(() => {
    if (isClosingRef.current) return;
    void syncActive();
  }, [activeTabId, activeTab.kind, activeTab.url, activePanel, isSidebarPinned, isPanelPinned, panelWidth, activeWorkspaceId]);

  useEffect(() => {
    if (isClosingRef.current) return;
    const observer = new ResizeObserver(() => scheduleSyncActive());
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", scheduleSyncActive);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSyncActive);
    };
  }, [scheduleSyncActive]);

  // Hide webview when omnibox dropdown is visible or when a modal is open
  useEffect(() => {
    if (isClosingRef.current) return;
    void (async () => {
      if (isOverlayActive) {
        await hideActiveWebview();
      } else {
        scheduleSyncActive();
      }
    })();
  }, [isOverlayActive, hideActiveWebview, scheduleSyncActive]);

  // ── Document chrome ───────────────────────────────────────────────

  useEffect(() => {
    document.title = `Aegis Browser - ${activeTab.title}`;
  }, [activeTab.title]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // ── Navigation actions ────────────────────────────────────────────

  function recordHistory(url: string, title: string) {
    if (isClosingRef.current) return;
    if (!url || url === "about:blank") return;
    const entry: HistoryEntry = { url, title, visitedAt: Date.now() };
    setHistoryEntries((prev) => [entry, ...prev].slice(0, 500));
    void appendHistory(entry);
  }

  function openInput(value: string) {
    const url = normalizeInput(value, settings.searchEngine);
    if (!url) return;
    if (!isPanelPinned) setActivePanel(null);
    setQuery("");
    if (activeTab.kind === "home") {
      createWebTab(url, titleFromUrl(url));
      return;
    }
    void navigateTab(activeTab.id, url);
  }

  async function navigateTab(id: string, url: string) {
    const tab = tabs.find((item) => item.id === id);
    if (tab) {
      await invoke("allow_navigation", { label: tab.label, url }).catch(() => undefined);
    }
    setTabs((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const history = item.history.slice(0, item.index + 1);
        history.push(url);
        return {
          ...item,
          kind: "web",
          title: titleFromUrl(url),
          url,
          history,
          index: history.length - 1,
        };
      }),
    );
    recordHistory(url, titleFromUrl(url));
    void invoke("navigate_webview", { label: tab?.label ?? "", url }).catch((err: unknown) => {
      console.error("Failed to navigate webview:", err);
    });
  }

  function switchHistory(direction: -1 | 1) {
    const tab = activeTab;
    if (tab.kind !== "web") return;
    const nextIndex = tab.index + direction;
    if (nextIndex < 0 || nextIndex >= tab.history.length) return;
    const nextUrl = tab.history[nextIndex];
    setTabs((current) =>
      current.map((item) =>
        item.id === tab.id
          ? { ...item, index: nextIndex, url: nextUrl, title: titleFromUrl(nextUrl) }
          : item,
      ),
    );
    void invoke("allow_navigation", { label: tab.label, url: nextUrl }).catch(() => undefined);
    void invoke("navigate_webview", { label: tab.label, url: nextUrl }).catch((err: unknown) => {
      console.error(`Failed to navigate ${direction < 0 ? "back" : "forward"}:`, err);
    });
  }

  const goBack = useCallback(() => switchHistory(-1), [activeTab]);
  const goForward = useCallback(() => switchHistory(1), [activeTab]);

  function reloadActive() {
    const tab = activeTab;
    if (tab.kind !== "web") return;
    setIsReloading(true);
    setIsLoading(true);
    void invoke("allow_navigation", { label: tab.label, url: tab.url })
      .then(() => invoke("navigate_webview", { label: tab.label, url: tab.url }))
      .catch(() => {
        showToast("Reload failed, recreating view", "error");
        void recreateTabWebview(tab);
      })
      .finally(() => {
        setTimeout(() => {
          setIsReloading(false);
          setIsLoading(false);
        }, 750);
      });
  }

  function createHomeTab() {
    if (!isSidebarPinned) setIsSidebarHovered(false);
    if (!isPanelPinned) setActivePanel(null);
    const tab = makeHomeTab(activeWorkspaceId);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function openUpdatesTab() {
    if (!isSidebarPinned) setIsSidebarHovered(false);
    if (!isPanelPinned) setActivePanel(null);
    const existing = tabs.find((tab) => tab.kind === "updates" && tab.workspaceId === activeWorkspaceId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab = makeUpdatesTab(activeWorkspaceId);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function openDevConsoleTab() {
    if (!isSidebarPinned) setIsSidebarHovered(false);
    if (!isPanelPinned) setActivePanel(null);
    const existing = tabs.find((tab) => tab.kind === "console" && tab.workspaceId === activeWorkspaceId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab = makeConsoleTab(activeWorkspaceId);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    const targetTab = tabs.find((t) => t.id === id);
    if (targetTab) {
      void recordClosedTab(targetTab);
    }
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      return next.length ? next : [makeHomeTab(activeWorkspaceId)];
    });
    if (activeTabId === id) {
      const remainingVisible = visibleTabs.filter((tab) => tab.id !== id);
      // 1. Check MRU activation history for the previous active tab
      const prevActiveId = tabHistoryRef.current.find(
        (histId) => histId !== id && remainingVisible.some((t) => t.id === histId),
      );
      if (prevActiveId) {
        setActiveTabId(prevActiveId);
      } else {
        // 2. Fallback: adjacent tab (left neighbor, or right neighbor)
        const closedIndex = visibleTabs.findIndex((t) => t.id === id);
        const adjacentTab =
          (closedIndex > 0 ? visibleTabs[closedIndex - 1] : visibleTabs[closedIndex + 1]) ??
          remainingVisible[0] ??
          makeHomeTab(activeWorkspaceId);
        setActiveTabId(adjacentTab.id);
      }
      tabHistoryRef.current = tabHistoryRef.current.filter((histId) => histId !== id);
    }
    void destroyTabWebview(id);

    // If the closed tab was part of a split pair, dissolve the split
    setSplitState((prev) => {
      if (!prev) return null;
      if (prev.leftTabId === id || prev.rightTabId === id) {
        return null; // dissolve split — the surviving tab returns to normal view
      }
      return prev;
    });

    // Auto-dissolve group if only 1 tab remains
    if (targetTab?.group) {
      const gId = targetTab.group;
      const remainingInGroup = tabs.filter((t) => t.group === gId && t.id !== id);
      if (remainingInGroup.length === 1) {
        setTabs((prev) => prev.map((t) => (t.group === gId ? { ...t, group: undefined } : t)));
        setTabGroups((prev) => {
          const next = { ...prev };
          delete next[gId];
          return next;
        });
      }
    }
  }

  function closeOtherTabs(id: string) {
    const toClose = visibleTabs.filter((t) => t.id !== id);
    for (const t of toClose) void destroyTabWebview(t.id);
    setTabs((prev) => prev.filter((t) => !toClose.some((c) => c.id === t.id) || t.id === id));
    setActiveTabId(id);
  }

  function closeTabsToRight(tabIndex: number) {
    const toClose = visibleTabs.slice(tabIndex + 1);
    for (const t of toClose) void destroyTabWebview(t.id);
    setTabs((prev) => prev.filter((t) => !toClose.some((c) => c.id === t.id)));
  }

  function duplicateTab(tab: Tab) {
    createWebTab(tab.url || "https://duckduckgo.com", tab.title, tab.group);
  }

  // ── Tab Groups Management ─────────────────────────────────────────

  function updateTabGroup(groupId: string, updates: Partial<TabGroup>) {
    setTabGroups((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] || { id: groupId, name: groupId, color: "#6e9bff" }),
        ...updates,
      },
    }));
  }

  function ungroupTabs(groupId: string) {
    setTabs((prev) => prev.map((t) => (t.group === groupId ? { ...t, group: undefined } : t)));
    setTabGroups((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    showToast("Tabs ungrouped", "info");
  }

  function closeTabGroup(groupId: string) {
    const tabsToClose = tabs.filter((t) => t.group === groupId);
    for (const t of tabsToClose) {
      void destroyTabWebview(t.id);
    }
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.group !== groupId);
      return remaining.length ? remaining : [makeHomeTab(activeWorkspaceId)];
    });
    if (tabsToClose.some((t) => t.id === activeTabId)) {
      const remainingVisible = visibleTabs.filter((t) => t.group !== groupId);
      setActiveTabId(remainingVisible[0]?.id ?? HOME_TAB_ID);
    }
    setTabGroups((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    showToast(`Closed ${tabsToClose.length} tabs`, "info");
  }

  function groupTabsTogether(tabIds: string[], groupName?: string) {
    const groupId = uid();
    const name = groupName || `Group ${Object.keys(tabGroups).length + 1}`;
    setTabGroups((prev) => ({
      ...prev,
      [groupId]: { id: groupId, name, color: "#6e9bff", workspaceId: activeWorkspaceId },
    }));
    setTabs((prev) =>
      prev.map((t) => (tabIds.includes(t.id) ? { ...t, group: groupId } : t)),
    );
    showToast(`Created ${name}`, "success");
  }

  function addTabToGroup(tabId: string, groupId: string) {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, group: groupId } : t)));
  }

  function removeTabFromGroup(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || !tab.group) return;
    const gId = tab.group;

    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, group: undefined } : t)));

    // If only 1 tab remaining in the group, auto-dissolve
    const remaining = tabs.filter((t) => t.group === gId && t.id !== tabId);
    if (remaining.length <= 1) {
      setTabs((prev) => prev.map((t) => (t.group === gId ? { ...t, group: undefined } : t)));
      setTabGroups((prev) => {
        const next = { ...prev };
        delete next[gId];
        return next;
      });
    }
  }

  function handleReorderTabs(newVisibleTabs: Tab[]) {
    setTabs((prev) => {
      const otherTabs = prev.filter((t) => {
        const g = t.group ? tabGroups[t.group] : undefined;
        const wsId = t.workspaceId || g?.workspaceId || "personal";
        return wsId !== activeWorkspaceId;
      });
      return [...newVisibleTabs, ...otherTabs];
    });
  }

  // ── Workspace Switching & Creation ───────────────────────────────

  function handleCreateWorkspace(newWs: Workspace) {
    setWorkspaces((prev) => [...prev, newWs]);
    selectWorkspace(newWs.id);
    showToast(`Created ${newWs.name} workspace`, "success");
  }

  function selectWorkspace(wsId: string) {
    if (!isSidebarPinned) setIsSidebarHovered(false);
    if (!isPanelPinned) setActivePanel(null);
    setActiveWorkspaceId(wsId);
    const targetWs = workspaces.find((w) => w.id === wsId);

    const wsTabs = tabs.filter((t) => {
      const g = t.group ? tabGroups[t.group] : undefined;
      return (t.workspaceId || g?.workspaceId || "personal") === wsId;
    });

    if (wsTabs.length > 0) {
      setActiveTabId(wsTabs[0].id);
    } else {
      const newTab = makeHomeTab(wsId);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }

    if (targetWs) {
      showToast(`Switched to ${targetWs.name} workspace`, "info");
    }
  }

  async function handleClearProfileData(profileKey: string) {
    try {
      await invoke("clear_profile_data", { profileKey });
      if (activeTab.kind === "web") {
        await recreateTabWebview(activeTab);
      }
      showToast("Workspace profile reset successfully", "success");
    } catch (err: unknown) {
      console.error("Failed to clear profile data:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast(`Wipe failed: ${errMsg}`, "error");
    }
  }

  // ── Split screen handlers ─────────────────────────────────────────

  /** Called when a tab chip is dropped onto the left/right drop zone */
  const handleTabDropOnSplit = useCallback((tabId: string, side: "left" | "right") => {
    const currentActiveTabId = activeTabIdRef.current;
    if (tabId === currentActiveTabId && !splitState) {
      // Splitting the current single tab: keep it as active on the opposite side
      const newState: SplitViewState = {
        leftTabId:  side === "right" ? currentActiveTabId : tabId,
        rightTabId: side === "right" ? tabId : currentActiveTabId,
        ratio: 0.5,
        activeSide: side,
      };
      setSplitState(newState);
    } else {
      const newState: SplitViewState = {
        leftTabId:  side === "right" ? currentActiveTabId : tabId,
        rightTabId: side === "right" ? tabId : currentActiveTabId,
        ratio: 0.5,
        activeSide: side,
      };
      setSplitState(newState);
    }
    setSplitDragSide(null);
    setTimeout(() => void scheduleSyncActive(), 50);
  }, [splitState, scheduleSyncActive]);

  const handleCloseSplit = useCallback(() => {
    setSplitState(null);
    setSplitDragSide(null);
    setTimeout(() => void scheduleSyncActive(), 50);
  }, [scheduleSyncActive]);

  const handleSplitRatioChange = useCallback((ratio: number) => {
    setSplitState((prev) => prev ? { ...prev, ratio } : null);
    setTimeout(() => void scheduleSyncActive(), 16);
  }, [scheduleSyncActive]);

  const handleSplitSwapSides = useCallback(() => {
    setSplitState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        leftTabId: prev.rightTabId,
        rightTabId: prev.leftTabId,
      };
    });
    setTimeout(() => void scheduleSyncActive(), 50);
  }, [scheduleSyncActive]);

  // ── Native Context Menus (Website Remains 100% Visible) ───────────

  const handleOpenContextMenu = useCallback(
    async (data: ContextMenuData) => {
      try {
        if (data.type === "split-divider") {
          const items: Array<MenuItem | PredefinedMenuItem> = [
            await MenuItem.new({
              text: "Swap Sides",
              action: () => handleSplitSwapSides(),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Exit Split View",
              action: () => handleCloseSplit(),
            }),
          ];
          const menu = await Menu.new({ items });
          await menu.popup();
          return;
        }

        if (data.type === "tab") {
          const { tab, tabIndex, totalTabs } = data;
          const isGrouped = !!tab.group;
          const availableGroups = Object.values(tabGroups).filter((g) => g.id !== tab.group);

          const items: Array<MenuItem | PredefinedMenuItem | Submenu> = [
            await MenuItem.new({
              text: "Reload Tab",
              action: () => reloadActive(),
            }),
            await MenuItem.new({
              text: "Duplicate Tab",
              action: () => duplicateTab(tab),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
          ];

          if (isGrouped) {
            items.push(
              await MenuItem.new({
                text: "Remove from Group",
                action: () => removeTabFromGroup(tab.id),
              }),
            );
          } else {
            items.push(
              await MenuItem.new({
                text: "Add to New Group",
                action: () => groupTabsTogether([tab.id]),
              }),
            );
            if (availableGroups.length > 0) {
              const groupSubmenuItems: MenuItem[] = [];
              for (const g of availableGroups) {
                groupSubmenuItems.push(
                  await MenuItem.new({
                    text: g.name,
                    action: () => addTabToGroup(tab.id, g.id),
                  }),
                );
              }
              items.push(
                await Submenu.new({
                  text: "Move to Group",
                  items: groupSubmenuItems,
                }),
              );
            }
          }

          items.push(
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Close Tab",
              action: () => closeTab(tab.id),
            }),
            await MenuItem.new({
              text: "Close Other Tabs",
              action: () => closeOtherTabs(tab.id),
            }),
          );

          if (tabIndex < totalTabs - 1) {
            items.push(
              await MenuItem.new({
                text: "Close Tabs to the Right",
                action: () => closeTabsToRight(tabIndex),
              }),
            );
          }

          const menu = await Menu.new({ items });
          await menu.popup();
          return;
        }

        if (data.type === "group") {
          const { group } = data;
          const items: Array<MenuItem | PredefinedMenuItem> = [
            await MenuItem.new({
              text: `Rename "${group.name}"`,
              action: () => {
                const newName = window.prompt("Enter new group name:", group.name);
                if (newName && newName.trim()) {
                  updateTabGroup(group.id, { name: newName.trim() });
                }
              },
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Ungroup Tabs",
              action: () => ungroupTabs(group.id),
            }),
            await MenuItem.new({
              text: "Close Group",
              action: () => closeTabGroup(group.id),
            }),
          ];

          const menu = await Menu.new({ items });
          await menu.popup();
          return;
        }

        if (data.type === "page") {
          const items: MenuItem[] = [
            await MenuItem.new({
              text: "New Tab",
              action: () => createHomeTab(),
            }),
          ];
          if (data.url) {
            items.push(
              await MenuItem.new({
                text: "Copy Page URL",
                action: () => {
                  if (data.url) void navigator.clipboard.writeText(data.url);
                },
              }),
            );
          }
          const menu = await Menu.new({ items });
          await menu.popup();
        }
      } catch (err) {
        console.error("Context menu popup error:", err);
      }
    },
    [tabGroups, activeTabId, activeWorkspaceId, tabs, visibleTabs],
  );

  // ── Voice & QR ────────────────────────────────────────────────────

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      setQuery(transcript);
      openInput(transcript);
    },
    [activeTab, settings.searchEngine],
  );
  const { isListening, startVoiceSearch } = useVoiceSearch(handleVoiceResult);
  const { triggerScan } = useQrScan((text) => {
    openInput(text);
  });

  // ── Bookmarks ─────────────────────────────────────────────────────

  function addBookmark(title: string, url: string) {
    if (!title.trim() || !url.trim()) return;
    setBookmarks((prev) => [
      { id: uid(), title: title.trim(), url: url.trim(), createdAt: Date.now() },
      ...prev,
    ]);
    showToast("Bookmark added", "success");
  }

  function removeBookmark(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  // ── Panel management ──────────────────────────────────────────────

  function togglePanel(panel: PanelId) {
    if (!isSidebarPinned) setIsSidebarHovered(false);
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function toggleMute(panel: PanelId) {
    setMutedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        next.delete(panel);
      } else {
        next.add(panel);
      }
      void invoke("set_webview_muted", {
        label: `Aegis-panel-${panel}`,
        muted: next.has(panel),
      }).catch((err: unknown) => console.error("Failed to toggle mute:", err));
      return next;
    });
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;

    setIsResizing(true);

    function doResize(moveEvent: MouseEvent) {
      const newWidth = Math.max(220, Math.min(600, startWidth + (moveEvent.clientX - startX)));
      setPanelWidth(newWidth);
      panelWidthRef.current = newWidth;
      requestAnimationFrame(() => void syncPanelOnly());
    }

    function stopResize() {
      window.removeEventListener("mousemove", doResize);
      window.removeEventListener("mouseup", stopResize);
      setIsResizing(false);
      scheduleSyncActive();
    }

    window.addEventListener("mousemove", doResize);
    window.addEventListener("mouseup", stopResize);
  }

  // ── Window controls & window dragging ─────────────────────────────

  const closeWindow = useCallback(() => getCurrentWindow().close(), []);
  const minimizeWindow = useCallback(() => getCurrentWindow().minimize(), []);
  const toggleMaximize = useCallback(() => getCurrentWindow().toggleMaximize(), []);

  const handleStartWindowDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Do not initiate window drag if clicking on interactive elements or .no-drag areas
    if (
      target.closest(".no-drag") !== null ||
      target.closest("button, input, textarea, [role='tab'], .tab, .tab-group, .tab-group-icon, .window-dot, .tab-plus-btn, .chrome-action-btn, .nav-btn") !== null
    ) {
      return;
    }
    void getCurrentWindow().startDragging();
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────

  const focusOmnibox = useCallback(() => {
    const input =
      (document.getElementById("omnibox") as HTMLInputElement | null) ||
      (document.getElementById("home-search-input") as HTMLInputElement | null);
    input?.focus();
    input?.select();
  }, []);

  useKeyboardShortcuts({
    focusOmnibox,
    newTab: useCallback(() => createHomeTab(), []),
    closeTab: useCallback(() => closeTab(activeTabId), [activeTabId]),
    reload: useCallback(() => reloadActive(), [activeTab]),
    goBack,
    goForward,
  });

  // ── Suggestions ───────────────────────────────────────────────────

  const suggestions = useSuggestions(query, historyEntries, bookmarks);

  // ── Derived UI flags ──────────────────────────────────────────────

  const contentIsHome = activeTab.kind === "home";
  const contentIsUpdates = activeTab.kind === "updates";
  const contentIsConsole = activeTab.kind === "console";
  // Split view only applies when the currently active tab is one of the two paired split tabs
  const contentIsSplit =
    splitState !== null &&
    (activeTabId === splitState.leftTabId || activeTabId === splitState.rightTabId);
  const splitLeftTab = splitState ? (tabs.find((t) => t.id === splitState.leftTabId) ?? null) : null;
  const splitRightTab = splitState ? (tabs.find((t) => t.id === splitState.rightTabId) ?? null) : null;
  const canGoBack = activeTab.kind === "web" && activeTab.index > 0;
  const canGoForward = activeTab.kind === "web" && activeTab.index < activeTab.history.length - 1;
  const panelIsWebApp = activePanel !== null && isWebAppPanel(activePanel);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* ── Left Sidebar running full window height from top to bottom ── */}
      <Sidebar
        ref={sidebarShellRef}
        isPinned={isSidebarPinned}
        onTogglePin={() => {
          setIsSidebarPinned(!isSidebarPinned);
          if (isSidebarPinned) setIsSidebarHovered(false);
        }}
        activePanel={activePanel}
        onTogglePanel={togglePanel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={selectWorkspace}
        onAddWorkspace={() => setIsCreateWorkspaceOpen(true)}
        workspaceTabCounts={workspaceTabCounts}
        onHomeClick={createHomeTab}
        onConsoleClick={openDevConsoleTab}
        isConsoleOpen={contentIsConsole}
        onUpdatesClick={openUpdatesTab}
        isUpdatesOpen={contentIsUpdates}
        isHovered={isSidebarHovered}
        onHoverChange={(hovered) => {
          setIsSidebarHovered(hovered);
          scheduleSyncActive();
        }}
        onTransitionEnd={() => scheduleSyncActive()}
      />

      {/* ── Sidebar Panel docked directly to sidebar running full window height ── */}
      {activePanel && (
        <section
          ref={sidePanelRef}
          className={`side-panel no-drag ${isPanelPinned ? "pinned" : "unpinned"} ${isResizing ? "resizing" : ""}`}
          style={{ width: `${panelWidth}px` }}
          onMouseEnter={() => {
            if (!isSidebarPinned) setIsSidebarHovered(false);
          }}
          onPointerEnter={() => {
            if (!isSidebarPinned) setIsSidebarHovered(false);
          }}
        >
          <div className="panel-header">
            <span className="panel-title">
              {activePanel.charAt(0).toUpperCase() + activePanel.slice(1)}
            </span>
            <div className="panel-controls no-drag">
              {panelIsWebApp && (
                <button
                  className={`panel-ctrl-btn ${activePanel && mutedPanels.has(activePanel) ? "active" : ""}`}
                  onClick={() => activePanel && toggleMute(activePanel)}
                  title={activePanel && mutedPanels.has(activePanel) ? "Unmute" : "Mute"}
                >
                  {activePanel && mutedPanels.has(activePanel) ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
              )}
              <button
                className={`panel-ctrl-btn ${isPanelPinned ? "active" : ""}`}
                onClick={() => setIsPanelPinned(!isPanelPinned)}
                title={isPanelPinned ? "Unpin panel (closes when clicking outside)" : "Pin panel"}
              >
                <Pin size={13} />
              </button>
              <button className="panel-ctrl-btn" onClick={() => setActivePanel(null)} title="Close panel">
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="panel-content">
            <PanelContent
              activePanel={activePanel}
              panelContentRef={panelContentRef}
              bookmarks={bookmarks}
              onAddBookmark={addBookmark}
              onRemoveBookmark={removeBookmark}
              onOpenBookmark={(bm) => {
                if (!isPanelPinned) setActivePanel(null);
                createWebTab(bm.url, bm.title);
              }}
              historyEntries={historyEntries}
              onClearHistory={() => {
                setHistoryEntries([]);
                void clearHistoryDb();
              }}
              onOpenHistoryEntry={(entry) => {
                if (!isPanelPinned) setActivePanel(null);
                createWebTab(entry.url, entry.title);
              }}
              downloads={downloads}
              onPauseDownload={(id) => downloadManager.pause(id)}
              onResumeDownload={(id) => downloadManager.startOrResume(id)}
              onCancelDownload={(id) => downloadManager.cancel(id)}
              onRetryDownload={(id) => downloadManager.retry(id)}
              onDeleteDownload={(id) => downloadManager.delete(id)}
              settings={settings}
              onSettingsChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
              activeWorkspaceId={activeWorkspaceId}
              onClearDownloads={() => downloadManager.clearAll()}
              onClearProfileData={handleClearProfileData}
            />
          </div>
          <div className="panel-resize-handle no-drag" onMouseDown={startResize} title="Resize panel" />
        </section>
      )}

      {/* ── Main App Content Column (Top Chrome Bar + Web Viewport) ── */}
      <div
        className="main-content-column"
        onMouseEnter={() => {
          if (!isSidebarPinned) setIsSidebarHovered(false);
        }}
        onPointerEnter={() => {
          if (!isSidebarPinned) setIsSidebarHovered(false);
        }}
      >
        {/* Top Window Bar: Tabs on Left, Window Drag Region, Window Dots on Far Right */}
        <header className="chrome" data-tauri-drag-region="true" onMouseDown={handleStartWindowDrag}>
          <div className="chrome-row" data-tauri-drag-region="true" onMouseDown={handleStartWindowDrag}>
            <TabStrip
              tabs={visibleTabs}
              activeTabId={activeTabId}
              tabGroups={tabGroups}
              splitState={splitState}
              isLoading={isLoading}
              onSwitch={setActiveTabId}
              onClose={closeTab}
              onNewTab={createHomeTab}
              onReorderTabs={handleReorderTabs}
              onGroupTabs={groupTabsTogether}
              onAddTabToGroup={addTabToGroup}
              onRemoveTabFromGroup={removeTabFromGroup}
              onOpenContextMenu={handleOpenContextMenu}
            />

            {/* Draggable spacer area */}
            <div
              className="chrome-spacer"
              data-tauri-drag-region="true"
              onMouseDown={(e) => {
                if (e.button === 0) void getCurrentWindow().startDragging();
              }}
            />

            {/* Window controls on FAR RIGHT in EXACT order: [ yellow ] [ green ] [ red ] */}
            <div className="window-dots no-drag" aria-label="Window controls">
              <button className="window-dot yellow" onClick={minimizeWindow} aria-label="Minimize window" title="Minimize" />
              <button className="window-dot green" onClick={toggleMaximize} aria-label="Maximize window" title="Maximize" />
              <button className="window-dot red" onClick={closeWindow} aria-label="Close window" title="Close" />
            </div>
          </div>
        </header>

        {/* Viewport Container fills the rest of the available space */}
        <div className="viewport-container">
          {/* Sub-Navigation Toolbar flush with the tab strip */}
          <div className="sub-toolbar no-drag">
            {contentIsSplit && splitState && splitLeftTab && splitRightTab ? (
              <div className="split-sub-toolbar-container">
                {/* Left Split URL & Navigation Bar */}
                <div
                  className={`split-sub-toolbar-half split-sub-toolbar-left ${splitState.activeSide === "left" ? "active-side" : ""}`}
                  style={{ width: `calc(${splitState.ratio * 100}% - 4px)` }}
                  onClick={() => setSplitState((prev) => prev ? { ...prev, activeSide: "left" } : null)}
                >
                  <div className="nav-cluster no-drag">
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitLeftTab.index > 0) {
                          const newIdx = splitLeftTab.index - 1;
                          const url = splitLeftTab.history[newIdx];
                          setTabs((prev) => prev.map((t) => t.id === splitLeftTab.id ? { ...t, url, index: newIdx } : t));
                          setTimeout(() => void scheduleSyncActive(), 50);
                        }
                      }}
                      disabled={splitLeftTab.index <= 0}
                      aria-label="Back"
                      title="Back"
                    >
                      <ChevronLeft size={15} strokeWidth={2} />
                    </button>
                    <div className="nav-divider" />
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitLeftTab.index < splitLeftTab.history.length - 1) {
                          const newIdx = splitLeftTab.index + 1;
                          const url = splitLeftTab.history[newIdx];
                          setTabs((prev) => prev.map((t) => t.id === splitLeftTab.id ? { ...t, url, index: newIdx } : t));
                          setTimeout(() => void scheduleSyncActive(), 50);
                        }
                      }}
                      disabled={splitLeftTab.index >= splitLeftTab.history.length - 1}
                      aria-label="Forward"
                      title="Forward"
                    >
                      <ChevronRight size={15} strokeWidth={2} />
                    </button>
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitLeftTab.url) {
                          navigator.clipboard.writeText(splitLeftTab.url);
                          showToast("URL copied to clipboard", "success");
                        }
                      }}
                      disabled={!splitLeftTab.url}
                      aria-label="Share / Copy Link"
                      title="Share link"
                    >
                      <Upload size={13} strokeWidth={2} />
                    </button>
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsLoading(true);
                        void recreateTabWebview(splitLeftTab).finally(() => {
                          setTimeout(() => setIsLoading(false), 700);
                        });
                      }}
                      disabled={splitLeftTab.kind !== "web"}
                      aria-label="Reload"
                      title="Reload"
                    >
                      <RotateCw size={13} strokeWidth={2} className={isLoading ? "tab-loading-spin" : ""} />
                    </button>
                  </div>

                  <Omnibox
                    url={splitLeftTab.url || ""}
                    query={splitState.activeSide === "left" ? query : ""}
                    onQueryChange={(val) => {
                      if (splitState.activeSide === "left") setQuery(val);
                    }}
                    onSubmit={(value) => {
                      let url = value.trim();
                      if (!url) return;
                      if (!/^https?:\/\//i.test(url) && !url.startsWith("http")) {
                        url = url.includes(".") && !url.includes(" ")
                          ? `https://${url}`
                          : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
                      }
                      const newHistory = [...splitLeftTab.history.slice(0, splitLeftTab.index + 1), url];
                      setTabs((prev) => prev.map((t) =>
                        t.id === splitLeftTab.id ? { ...t, url, history: newHistory, index: newHistory.length - 1, title: url } : t
                      ));
                      setTimeout(() => void scheduleSyncActive(), 50);
                    }}
                    suggestions={splitState.activeSide === "left" ? suggestions : []}
                    onScan={triggerScan}
                    onVoice={startVoiceSearch}
                    isListening={isListening}
                  />
                </div>

                {/* Vertical Blue Separator between the two URL bars in toolbar */}
                <div className="split-sub-toolbar-divider" />

                {/* Right Split URL & Navigation Bar */}
                <div
                  className={`split-sub-toolbar-half split-sub-toolbar-right ${splitState.activeSide === "right" ? "active-side" : ""}`}
                  style={{ width: `calc(${(1 - splitState.ratio) * 100}% - 4px)` }}
                  onClick={() => setSplitState((prev) => prev ? { ...prev, activeSide: "right" } : null)}
                >
                  <div className="nav-cluster no-drag">
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitRightTab.index > 0) {
                          const newIdx = splitRightTab.index - 1;
                          const url = splitRightTab.history[newIdx];
                          setTabs((prev) => prev.map((t) => t.id === splitRightTab.id ? { ...t, url, index: newIdx } : t));
                          setTimeout(() => void scheduleSyncActive(), 50);
                        }
                      }}
                      disabled={splitRightTab.index <= 0}
                      aria-label="Back"
                      title="Back"
                    >
                      <ChevronLeft size={15} strokeWidth={2} />
                    </button>
                    <div className="nav-divider" />
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitRightTab.index < splitRightTab.history.length - 1) {
                          const newIdx = splitRightTab.index + 1;
                          const url = splitRightTab.history[newIdx];
                          setTabs((prev) => prev.map((t) => t.id === splitRightTab.id ? { ...t, url, index: newIdx } : t));
                          setTimeout(() => void scheduleSyncActive(), 50);
                        }
                      }}
                      disabled={splitRightTab.index >= splitRightTab.history.length - 1}
                      aria-label="Forward"
                      title="Forward"
                    >
                      <ChevronRight size={15} strokeWidth={2} />
                    </button>
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (splitRightTab.url) {
                          navigator.clipboard.writeText(splitRightTab.url);
                          showToast("URL copied to clipboard", "success");
                        }
                      }}
                      disabled={!splitRightTab.url}
                      aria-label="Share / Copy Link"
                      title="Share link"
                    >
                      <Upload size={13} strokeWidth={2} />
                    </button>
                    <button
                      className="nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsLoading(true);
                        void recreateTabWebview(splitRightTab).finally(() => {
                          setTimeout(() => setIsLoading(false), 700);
                        });
                      }}
                      disabled={splitRightTab.kind !== "web"}
                      aria-label="Reload"
                      title="Reload"
                    >
                      <RotateCw size={13} strokeWidth={2} className={isLoading ? "tab-loading-spin" : ""} />
                    </button>
                  </div>

                  <Omnibox
                    url={splitRightTab.url || ""}
                    query={splitState.activeSide === "right" ? query : ""}
                    onQueryChange={(val) => {
                      if (splitState.activeSide === "right") setQuery(val);
                    }}
                    onSubmit={(value) => {
                      let url = value.trim();
                      if (!url) return;
                      if (!/^https?:\/\//i.test(url) && !url.startsWith("http")) {
                        url = url.includes(".") && !url.includes(" ")
                          ? `https://${url}`
                          : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
                      }
                      const newHistory = [...splitRightTab.history.slice(0, splitRightTab.index + 1), url];
                      setTabs((prev) => prev.map((t) =>
                        t.id === splitRightTab.id ? { ...t, url, history: newHistory, index: newHistory.length - 1, title: url } : t
                      ));
                      setTimeout(() => void scheduleSyncActive(), 50);
                    }}
                    suggestions={splitState.activeSide === "right" ? suggestions : []}
                    onScan={triggerScan}
                    onVoice={startVoiceSearch}
                    isListening={isListening}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="nav-cluster no-drag">
                  <button className="nav-btn" onClick={goBack} disabled={!canGoBack} aria-label="Back" title="Back">
                    <ChevronLeft size={15} strokeWidth={2} />
                  </button>
                  <div className="nav-divider" />
                  <button className="nav-btn" onClick={goForward} disabled={!canGoForward} aria-label="Forward" title="Forward">
                    <ChevronRight size={15} strokeWidth={2} />
                  </button>
                  <button
                    className="nav-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      if (activeTab.url) {
                        navigator.clipboard.writeText(activeTab.url);
                        showToast("URL copied to clipboard", "success");
                      }
                    }}
                    disabled={contentIsHome}
                    aria-label="Share / Copy Link"
                    title="Share link"
                  >
                    <Upload size={13} strokeWidth={2} />
                  </button>
                  <button className="nav-btn" onClick={reloadActive} disabled={activeTab.kind !== "web"} aria-label="Reload" title="Reload">
                    <RotateCw size={13} strokeWidth={2} className={isReloading ? "tab-loading-spin" : ""} />
                  </button>
                </div>

                {!contentIsHome && !contentIsUpdates && !contentIsConsole && (
                  <Omnibox
                    url={activeTab.url}
                    query={query}
                    onQueryChange={setQuery}
                    onSubmit={(value) => openInput(value)}
                    suggestions={suggestions}
                    onScan={triggerScan}
                    onVoice={startVoiceSearch}
                    isListening={isListening}
                  />
                )}

                <div className="sub-toolbar-spacer" />

                {/* Reorganized chrome actions positioned at the END of the sub-toolbar */}
                <ChromeActions
                  activePanel={activePanel}
                  onTogglePanel={togglePanel}
                  onNewTab={createHomeTab}
                  isSidebarPinned={isSidebarPinned}
                  onToggleSidebarPin={() => setIsSidebarPinned(!isSidebarPinned)}
                />
              </>
            )}
          </div>

          {/* Web Viewport & Home Screen Area */}
          <main
            className={`viewport-content${contentIsSplit ? " split-active" : ""}`}
            ref={contentRef}
            onContextMenu={(e) => {
              e.preventDefault();
              void handleOpenContextMenu({
                type: "page",
                x: e.clientX,
                y: e.clientY,
                url: activeTab.kind === "web" ? activeTab.url : undefined,
              });
            }}
            onPointerMove={(e) => {
              const isDraggingTab = (window as unknown as Record<string, unknown>).__aegisDraggingTabId != null;
              if (!isDraggingTab) {
                if (splitDragSide !== null) setSplitDragSide(null);
                return;
              }
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const relX = (e.clientX - rect.left) / rect.width;
              // 0-20%: preview hint; 20-35%: active drop zone; >65%: right drop
              if (relX < 0.35) {
                if (splitDragSide !== "left") setSplitDragSide("left");
              } else if (relX > 0.65) {
                if (splitDragSide !== "right") setSplitDragSide("right");
              } else {
                if (splitDragSide !== null) setSplitDragSide(null);
              }
            }}
            onPointerUp={() => {
              const draggingId = (window as unknown as Record<string, unknown>).__aegisDraggingTabId as string | null;
              if (draggingId && splitDragSide) {
                handleTabDropOnSplit(draggingId, splitDragSide);
              } else {
                setSplitDragSide(null);
              }
            }}
            onPointerLeave={() => {
              if (splitDragSide !== null) setSplitDragSide(null);
            }}
          >
            {/* Split drop zone overlays (shown while dragging a tab near an edge) */}
            {splitDragSide && (
              <SplitDropOverlay
                side={splitDragSide}
                draggedTab={tabs.find((t) => t.id === ((window as unknown as Record<string, unknown>).__aegisDraggingTabId as string)) ?? null}
              />
            )}

            {/* Split screen dual pane view */}
            {contentIsSplit && splitState && (
              <SplitViewport
                splitState={splitState}
                leftRef={splitLeftRef}
                rightRef={splitRightRef}
                onRatioChange={handleSplitRatioChange}
                onActiveSideChange={(side) => setSplitState((prev) => prev ? { ...prev, activeSide: side } : null)}
                onOpenContextMenu={handleOpenContextMenu}
              />
            )}

            {!contentIsSplit && contentIsHome ? (
              <HomeScreen
                settings={settings}
                query={query}
                onQueryChange={setQuery}
                onSubmit={(value) => openInput(value)}
                onScan={triggerScan}
                onVoice={startVoiceSearch}
                isListening={isListening}
              />
            ) : null}

            {!contentIsSplit && contentIsUpdates && <UpdatesScreen />}
            {!contentIsSplit && contentIsConsole && <DevConsoleScreen />}

            {!contentIsSplit && !contentIsHome && !contentIsUpdates && !contentIsConsole && (
              <div className={`loading-bar ${isLoading ? "loading" : ""}`} />
            )}
            <div
              className={`webview-holder ${
                contentIsSplit || contentIsHome || contentIsUpdates || contentIsConsole ? "hidden" : ""
              }`}
            />
          </main>
        </div>
      </div>

      <CreateWorkspaceModal
        isOpen={isCreateWorkspaceOpen}
        onClose={() => setIsCreateWorkspaceOpen(false)}
        onCreate={handleCreateWorkspace}
        existingCount={workspaces.length}
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
