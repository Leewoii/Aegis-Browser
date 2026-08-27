/**
 * SQLite-backed persistent storage service with schema migrations,
 * OS-backed DPAPI encryption, atomic transactions, and profile recovery.
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type {
  Tab,
  TabGroup,
  Workspace,
  Bookmark,
  HistoryEntry,
  DownloadEntry,
  Settings,
  SearchEngine,
  SidebarState,
  ClosedTab,
  WindowState,
  PanelId,
} from "../types";
import {
  STORAGE_KEY_TABS,
  STORAGE_KEY_SETTINGS,
  STORAGE_KEY_BOOKMARKS,
  STORAGE_KEY_HISTORY,
  STORAGE_KEY_DOWNLOADS,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACES,
  HOME_TAB_ID,
} from "../utils/browser";
import { debugLog } from "./debug";
import { devConsole } from "./devConsole";

type SqliteDatabase = Awaited<ReturnType<typeof Database.load>>;

let db: SqliteDatabase | null = null;
let initPromise: Promise<SqliteDatabase> | null = null;
type GlobalStorageState = {
  writeQueue: Promise<void>;
};

const globalStorageState = globalThis as typeof globalThis & {
  __AegisStorageState?: GlobalStorageState;
};

if (!globalStorageState.__AegisStorageState) {
  globalStorageState.__AegisStorageState = {
    writeQueue: Promise.resolve(),
  };
}

function getWriteQueueState(): GlobalStorageState {
  return globalStorageState.__AegisStorageState!;
}

export async function getDb(): Promise<SqliteDatabase> {
  if (db) return db;
  if (!initPromise) {
    devConsole.setDbStatus("connecting");
    devConsole.db({
      operation: "CONNECT",
      tableOrQuery: "sqlite:Aegis.db",
      status: "success",
      details: { db: "Aegis.db" },
    });
    initPromise = Database.load("sqlite:Aegis.db")
      .then((database) => {
        db = database;
        devConsole.setDbStatus("connected");
        devConsole.db({
          operation: "CONNECTED",
          tableOrQuery: "sqlite:Aegis.db",
          status: "success",
          details: { status: "ready" },
        });
        return database;
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        devConsole.setDbStatus("error", msg);
        devConsole.db({
          operation: "CONNECT",
          tableOrQuery: "sqlite:Aegis.db",
          status: "error",
          error: error as Error,
        });
        throw error;
      });
  }
  return initPromise;
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const state = getWriteQueueState();
  const result = state.writeQueue.then(
    () => retryLockedWrite(operation),
    () => retryLockedWrite(operation),
  );
  state.writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isBusyDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("database is locked") || message.includes("SQLITE_BUSY");
}

async function retryLockedWrite<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isBusyDatabaseError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Schema & Migration Helpers
// ---------------------------------------------------------------------------

async function migrateV1ToV2(database: SqliteDatabase): Promise<void> {
  await database.execute(
    `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        idx INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tab_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        collapsed INTEGER NOT NULL DEFAULT 0,
        workspace_id TEXT NOT NULL DEFAULT 'personal',
        idx INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tabs_v2 (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        history TEXT NOT NULL DEFAULT '[]',
        idx INTEGER NOT NULL DEFAULT 0,
        workspace_id TEXT NOT NULL DEFAULT 'personal',
        group_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        muted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sidebar_state (
        key TEXT PRIMARY KEY,
        is_sidebar_pinned INTEGER NOT NULL DEFAULT 0,
        active_panel TEXT,
        is_panel_pinned INTEGER NOT NULL DEFAULT 0,
        panel_width INTEGER NOT NULL DEFAULT 340,
        muted_panels TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS closed_tabs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        tab_data TEXT NOT NULL,
        closed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secure_vault (
        key TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS downloads_v2 (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        url TEXT NOT NULL,
        destination TEXT,
        total_bytes REAL NOT NULL DEFAULT 0,
        received_bytes REAL NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'completed',
        started_at INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        visited_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  );

  // 1. Migrate Workspaces from meta table if workspaces table is empty
  const wsCount = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM workspaces");
  if (wsCount[0].count === 0) {
    const metaWs = await database.select<Array<{ value: string }>>(
      "SELECT value FROM meta WHERE key = 'workspaces'",
    );
    let workspaces: Workspace[] = DEFAULT_WORKSPACES;
    if (metaWs.length > 0 && metaWs[0].value) {
      try {
        workspaces = JSON.parse(metaWs[0].value);
      } catch {
        workspaces = DEFAULT_WORKSPACES;
      }
    }
    for (let i = 0; i < workspaces.length; i++) {
      const w = workspaces[i];
      await database.execute(
        `INSERT OR REPLACE INTO workspaces (id, name, icon, color, idx, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [w.id, w.name, w.icon || null, w.color || null, i, Date.now()],
      );
    }
  }

  // 2. Migrate Tab Groups from meta table if tab_groups table is empty
  const groupCount = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM tab_groups");
  if (groupCount[0].count === 0) {
    const metaGroups = await database.select<Array<{ value: string }>>(
      "SELECT value FROM meta WHERE key = 'tabGroups'",
    );
    if (metaGroups.length > 0 && metaGroups[0].value) {
      try {
        const groups = JSON.parse(metaGroups[0].value) as Record<string, TabGroup>;
        let i = 0;
        for (const g of Object.values(groups)) {
          await database.execute(
            `INSERT OR REPLACE INTO tab_groups (id, name, color, collapsed, workspace_id, idx)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [g.id, g.name, g.color || null, g.collapsed ? 1 : 0, g.workspaceId || "personal", i++],
          );
        }
      } catch {
        // ignore corrupt json
      }
    }
  }

  // 3. Migrate Tabs from tabs to tabs_v2 if tabs_v2 is empty
  const tabsV2Count = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM tabs_v2");
  if (tabsV2Count[0].count === 0) {
    try {
      const oldTabs = await database.select<
        Array<{ id: string; kind: string; title: string; url: string; label: string; history: string; idx: number }>
      >("SELECT * FROM tabs");
      for (const t of oldTabs) {
        let historyArr: string[] = [];
        let group: string | undefined = undefined;
        let index = 0;
        try {
          const parsed = JSON.parse(t.history || "[]");
          if (Array.isArray(parsed)) {
            historyArr = parsed;
          } else if (parsed && typeof parsed === "object") {
            historyArr = parsed.history || [];
            group = parsed.group;
            index = parsed.index ?? 0;
          }
        } catch {
          historyArr = [];
        }

        await database.execute(
          `INSERT OR REPLACE INTO tabs_v2 (id, kind, title, url, label, history, idx, workspace_id, group_id, pinned, muted, created_at, last_accessed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            t.id,
            t.kind,
            t.title,
            t.url || "",
            t.label,
            JSON.stringify(historyArr),
            t.idx || index || 0,
            "personal",
            group || null,
            0,
            0,
            Date.now(),
            Date.now(),
          ],
        );
      }
    } catch {
      // tabs table may not exist
    }
  }

  // 4. Migrate Downloads to downloads_v2 if downloads_v2 is empty
  const dlV2Count = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM downloads_v2");
  if (dlV2Count[0].count === 0) {
    try {
      const oldDl = await database.select<
        Array<{ id: string; filename: string; url: string; total_bytes: number; received_bytes: number; completed: number; created_at: number }>
      >("SELECT * FROM downloads");
      for (const d of oldDl) {
        await database.execute(
          `INSERT OR REPLACE INTO downloads_v2 (id, filename, url, destination, total_bytes, received_bytes, state, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            d.id,
            d.filename,
            d.url,
            null,
            d.total_bytes,
            d.received_bytes,
            d.completed ? "completed" : "failed",
            d.created_at,
            d.completed ? d.created_at : 0,
          ],
        );
      }
    } catch {
      // ignore
    }
  }

  // 5. Clean up interrupted downloads on startup:
  // If browser crashed or closed while a download was in_progress, mark it paused so it can be resumed
  await database.execute(
    "UPDATE downloads_v2 SET state = 'paused' WHERE state = 'in_progress'",
  );
}

// ---------------------------------------------------------------------------
// localStorage → SQLite migration
// ---------------------------------------------------------------------------

async function migrateFromLocalStorage(): Promise<void> {
  const database = await getDb();

  const row = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM tabs_v2");
  if (row[0].count > 0) return;

  const tabsRaw = localStorage.getItem(STORAGE_KEY_TABS);
  const settingsRaw = localStorage.getItem(STORAGE_KEY_SETTINGS);
  const bookmarksRaw = localStorage.getItem(STORAGE_KEY_BOOKMARKS);
  const historyRaw = localStorage.getItem(STORAGE_KEY_HISTORY);
  const downloadsRaw = localStorage.getItem(STORAGE_KEY_DOWNLOADS);

  if (!tabsRaw && !settingsRaw && !bookmarksRaw && !historyRaw && !downloadsRaw) return;

  if (tabsRaw) {
    try {
      const parsed = JSON.parse(tabsRaw) as { tabs: Tab[]; activeTabId: string };
      for (const tab of parsed.tabs ?? []) {
        await insertTab(database, tab);
      }
      await database.execute(
        "INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES ('activeTabId', $1, $2)",
        [parsed.activeTabId ?? HOME_TAB_ID, Date.now()],
      );
    } catch {
      // Ignore corrupt legacy data
    }
  }

  if (settingsRaw) {
    try {
      const parsed = JSON.parse(settingsRaw) as Partial<Settings>;
      await upsertSetting(database, "theme", parsed.theme ?? DEFAULT_SETTINGS.theme);
      await upsertSetting(database, "searchEngine", parsed.searchEngine ?? DEFAULT_SETTINGS.searchEngine);
      await upsertSetting(database, "homeGreeting", parsed.homeGreeting ?? DEFAULT_SETTINGS.homeGreeting);
    } catch {
      // Ignore corrupt legacy data
    }
  }

  if (bookmarksRaw) {
    try {
      const parsed = JSON.parse(bookmarksRaw) as Bookmark[];
      for (const b of parsed ?? []) {
        await database.execute(
          `INSERT OR REPLACE INTO bookmarks (id, title, url, created_at)
           VALUES ($1, $2, $3, $4)`,
          [b.id, b.title, b.url, b.createdAt],
        );
      }
    } catch {
      // Ignore corrupt legacy data
    }
  }

  if (historyRaw) {
    try {
      const parsed = JSON.parse(historyRaw) as HistoryEntry[];
      for (const h of parsed ?? []) {
        await insertHistory(database, h);
      }
    } catch {
      // Ignore corrupt legacy data
    }
  }

  if (downloadsRaw) {
    try {
      const parsed = JSON.parse(downloadsRaw) as DownloadEntry[];
      for (const d of parsed ?? []) {
        await insertDownload(database, d);
      }
    } catch {
      // Ignore corrupt legacy data
    }
  }

  try {
    for (const key of [
      STORAGE_KEY_TABS,
      STORAGE_KEY_SETTINGS,
      STORAGE_KEY_BOOKMARKS,
      STORAGE_KEY_HISTORY,
      STORAGE_KEY_DOWNLOADS,
    ]) {
      localStorage.removeItem(key);
    }
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

let initialised = false;
let initializePromise: Promise<void> | null = null;

export async function initializeStorage(): Promise<void> {
  if (initialised) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      await enqueueWrite(async () => {
        const database = await getDb();
        await migrateV1ToV2(database);
        await migrateFromLocalStorage();
      });
      initialised = true;
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  await initializePromise;
}

// ---------------------------------------------------------------------------
// Tabs & Groups & Workspaces
// ---------------------------------------------------------------------------

async function insertTab(database: SqliteDatabase, tab: Tab): Promise<void> {
  await database.execute(
    `INSERT OR REPLACE INTO tabs_v2 (
       id, kind, title, url, label, history, idx, workspace_id, group_id, pinned, muted, created_at, last_accessed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      tab.id,
      tab.kind,
      tab.title,
      tab.url ?? "",
      tab.label,
      JSON.stringify(tab.history ?? []),
      tab.index ?? 0,
      tab.workspaceId ?? "personal",
      tab.group || null,
      tab.pinned ? 1 : 0,
      tab.muted ? 1 : 0,
      tab.createdAt ?? Date.now(),
      tab.lastAccessedAt ?? Date.now(),
    ],
  );
}

export interface TabsData {
  tabs: Tab[];
  activeTabId: string;
}

export async function loadTabs(): Promise<TabsData> {
  const database = await getDb();
  const rows = await database.select<
    Array<{
      id: string;
      kind: string;
      title: string;
      url: string;
      label: string;
      history: string;
      idx: number;
      workspace_id: string;
      group_id: string | null;
      pinned: number;
      muted: number;
      created_at: number;
      last_accessed_at: number;
    }>
  >("SELECT * FROM tabs_v2 ORDER BY idx ASC");

  const tabs: Tab[] = rows.map((r) => {
    let history: string[] = [];
    try {
      history = JSON.parse(r.history || "[]");
    } catch {
      history = [];
    }

    return {
      id: r.id,
      kind: r.kind as Tab["kind"],
      title: r.title,
      url: r.url,
      label: r.label,
      history,
      index: r.idx ?? 0,
      workspaceId: r.workspace_id || "personal",
      group: r.group_id || undefined,
      pinned: r.pinned !== 0,
      muted: r.muted !== 0,
      createdAt: r.created_at,
      lastAccessedAt: r.last_accessed_at,
    };
  });

  let activeTabId = HOME_TAB_ID;
  try {
    const sessionRows = await database.select<Array<{ value: string }>>(
      "SELECT value FROM session_state WHERE key = 'activeTabId'",
    );
    if (sessionRows.length > 0) {
      activeTabId = sessionRows[0].value;
    } else {
      const meta = await database.select<Array<{ value: string }>>(
        "SELECT value FROM meta WHERE key = 'activeTabId'",
      );
      if (meta.length > 0) activeTabId = meta[0].value;
    }
  } catch {
    // Fallback
  }

  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0]?.id ?? HOME_TAB_ID;
  }

  return { tabs, activeTabId };
}

export async function saveTabs(tabs: Tab[], activeTabId: string): Promise<void> {
  return enqueueWrite(async () => {
    // #region DEBUG
    await debugLog(`[DEBUG H1] saveTabs start tabs=${tabs.length} activeTabId=${activeTabId}`);
    // #endregion DEBUG
    const database = await getDb();
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      await insertTab(database, { ...tab, index: i });
    }

    if (tabs.length === 0) {
      await database.execute("DELETE FROM tabs_v2");
    } else {
      const placeholders = tabs.map((_, index) => `$${index + 1}`).join(", ");
      await database.execute(
        `DELETE FROM tabs_v2 WHERE id NOT IN (${placeholders})`,
        tabs.map((tab) => tab.id),
      );
    }

    await database.execute(
      "INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES ('activeTabId', $1, $2)",
      [activeTabId, Date.now()],
    );
    // #region DEBUG
    await debugLog(`[DEBUG H1] saveTabs committed tabs=${tabs.length} activeTabId=${activeTabId}`);
    // #endregion DEBUG
    // #region DEBUG
    await debugLog(`[DEBUG H1] saveTabs end tabs=${tabs.length} activeTabId=${activeTabId}`);
    // #endregion DEBUG
  });
}

// ---------------------------------------------------------------------------
// Closed Tabs & Session Undo
// ---------------------------------------------------------------------------

export async function recordClosedTab(tab: Tab): Promise<void> {
  if (tab.kind === "home" || !tab.url || tab.url === "about:blank") return;
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute(
      `INSERT OR REPLACE INTO closed_tabs (id, workspace_id, title, url, tab_data, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tab.id,
        tab.workspaceId ?? "personal",
        tab.title,
        tab.url,
        JSON.stringify(tab),
        Date.now(),
      ],
    );

    // Keep closed tabs history to max 30 items
    await database.execute(
      `DELETE FROM closed_tabs WHERE id NOT IN (
         SELECT id FROM closed_tabs ORDER BY closed_at DESC LIMIT 30
       )`,
    );
  });
}

export async function loadClosedTabs(): Promise<ClosedTab[]> {
  const database = await getDb();
  const rows = await database.select<
    Array<{ id: string; workspace_id: string; title: string; url: string; tab_data: string; closed_at: number }>
  >("SELECT * FROM closed_tabs ORDER BY closed_at DESC LIMIT 30");

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    url: r.url,
    tabData: JSON.parse(r.tab_data) as Tab,
    closedAt: r.closed_at,
  }));
}

export async function restoreClosedTab(id: string): Promise<Tab | null> {
  return enqueueWrite(async () => {
    const database = await getDb();
    const rows = await database.select<Array<{ tab_data: string }>>(
      "SELECT tab_data FROM closed_tabs WHERE id = $1",
      [id],
    );
    if (!rows.length) return null;
    await database.execute("DELETE FROM closed_tabs WHERE id = $1", [id]);
    try {
      return JSON.parse(rows[0].tab_data) as Tab;
    } catch {
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// Tab Groups
// ---------------------------------------------------------------------------

export async function loadGroups(): Promise<Record<string, TabGroup>> {
  const database = await getDb();
  try {
    const rows = await database.select<
      Array<{ id: string; name: string; color: string | null; collapsed: number; workspace_id: string }>
    >("SELECT * FROM tab_groups ORDER BY idx ASC");

    if (rows.length > 0) {
      const result: Record<string, TabGroup> = {};
      for (const r of rows) {
        result[r.id] = {
          id: r.id,
          name: r.name,
          color: r.color || undefined,
          collapsed: r.collapsed !== 0,
          workspaceId: r.workspace_id,
        };
      }
      return result;
    }
  } catch {
    // fallback to meta
  }
  return {};
}

export async function saveGroups(groups: Record<string, TabGroup>): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    try {
      await database.execute("DELETE FROM tab_groups");
      let idx = 0;
      for (const g of Object.values(groups)) {
        await database.execute(
          `INSERT OR REPLACE INTO tab_groups (id, name, color, collapsed, workspace_id, idx)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [g.id, g.name, g.color || null, g.collapsed ? 1 : 0, g.workspaceId || "personal", idx++],
        );
      }
    } catch {
      // ignore
    }
  });
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function loadWorkspaces(): Promise<Workspace[]> {
  const database = await getDb();
  try {
    const rows = await database.select<
      Array<{ id: string; name: string; icon: string | null; color: string | null; idx: number }>
    >("SELECT * FROM workspaces ORDER BY idx ASC");

    if (rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon || undefined,
        color: r.color || undefined,
      }));
    }
  } catch {
    // ignore
  }
  return DEFAULT_WORKSPACES;
}

export async function saveWorkspaces(workspaces: Workspace[]): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    try {
      await database.execute("DELETE FROM workspaces");
      for (let i = 0; i < workspaces.length; i++) {
        const w = workspaces[i];
        await database.execute(
          `INSERT OR REPLACE INTO workspaces (id, name, icon, color, idx, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [w.id, w.name, w.icon || null, w.color || null, i, Date.now()],
        );
      }
    } catch {
      // ignore
    }
  });
}

export async function loadActiveWorkspace(): Promise<string> {
  const database = await getDb();
  try {
    const sessionRows = await database.select<Array<{ value: string }>>(
      "SELECT value FROM session_state WHERE key = 'activeWorkspace'",
    );
    if (sessionRows.length > 0 && sessionRows[0].value) {
      return sessionRows[0].value;
    }
    const meta = await database.select<Array<{ value: string }>>(
      "SELECT value FROM meta WHERE key = 'activeWorkspace'",
    );
    if (meta.length > 0 && meta[0].value) {
      return meta[0].value;
    }
  } catch {
    // ignore
  }
  return "personal";
}

export async function saveActiveWorkspace(wsId: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    try {
      await database.execute(
        "INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES ('activeWorkspace', $1, $2)",
        [wsId, Date.now()],
      );
    } catch {
      // ignore
    }
  });
}

// ---------------------------------------------------------------------------
// Sidebar & Panel Persistence
// ---------------------------------------------------------------------------

export async function loadSidebarState(): Promise<SidebarState> {
  const database = await getDb();
  try {
    const rows = await database.select<
      Array<{
        is_sidebar_pinned: number;
        active_panel: string | null;
        is_panel_pinned: number;
        panel_width: number;
        muted_panels: string;
      }>
    >("SELECT * FROM sidebar_state WHERE key = 'default'");

    if (rows.length > 0) {
      const r = rows[0];
      let mutedPanels: string[] = [];
      try {
        mutedPanels = JSON.parse(r.muted_panels || "[]");
      } catch {
        mutedPanels = [];
      }

      return {
        isSidebarPinned: r.is_sidebar_pinned !== 0,
        // Only restore active panel if it was pinned!
        activePanel: r.is_panel_pinned !== 0 && r.active_panel ? (r.active_panel as PanelId) : null,
        isPanelPinned: r.is_panel_pinned !== 0,
        panelWidth: r.panel_width || 340,
        mutedPanels,
      };
    }
  } catch {
    // ignore
  }
  return {
    isSidebarPinned: false,
    activePanel: null,
    isPanelPinned: false,
    panelWidth: 340,
    mutedPanels: [],
  };
}

export async function saveSidebarState(state: SidebarState): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    try {
      await database.execute(
        `INSERT OR REPLACE INTO sidebar_state (
           key, is_sidebar_pinned, active_panel, is_panel_pinned, panel_width, muted_panels, updated_at
         ) VALUES ('default', $1, $2, $3, $4, $5, $6)`,
        [
          state.isSidebarPinned ? 1 : 0,
          state.isPanelPinned ? state.activePanel || null : null,
          state.isPanelPinned ? 1 : 0,
          state.panelWidth || 340,
          JSON.stringify(state.mutedPanels || []),
          Date.now(),
        ],
      );
    } catch {
      // ignore
    }
  });
}

// ---------------------------------------------------------------------------
// Window State Persistence
// ---------------------------------------------------------------------------

export async function loadWindowState(): Promise<WindowState | null> {
  const database = await getDb();
  try {
    const rows = await database.select<Array<{ value: string }>>(
      "SELECT value FROM session_state WHERE key = 'windowState'",
    );
    if (rows.length > 0 && rows[0].value) {
      return JSON.parse(rows[0].value) as WindowState;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function saveWindowState(state: WindowState): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    try {
      await database.execute(
        "INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES ('windowState', $1, $2)",
        [JSON.stringify(state), Date.now()],
      );
    } catch {
      // ignore
    }
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function upsertSetting(database: SqliteDatabase, key: string, value: string): Promise<void> {
  await database.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [key, value]);
}

export async function loadSettings(): Promise<Settings> {
  const database = await getDb();
  const rows = await database.select<Array<{ key: string; value: string }>>(
    "SELECT key, value FROM settings",
  );

  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key === "theme") settings.theme = row.value as Settings["theme"];
    else if (row.key === "searchEngine") settings.searchEngine = row.value as SearchEngine;
    else if (row.key === "homeGreeting") settings.homeGreeting = row.value;
    else if (row.key === "startupBehavior") settings.startupBehavior = row.value as Settings["startupBehavior"];
    else if (row.key === "defaultDownloadsPath") settings.defaultDownloadsPath = row.value;
    else if (row.key === "adBlockingEnabled") settings.adBlockingEnabled = row.value === "true";
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await upsertSetting(database, "theme", settings.theme);
    await upsertSetting(database, "searchEngine", settings.searchEngine);
    await upsertSetting(database, "homeGreeting", settings.homeGreeting);
    await upsertSetting(database, "startupBehavior", settings.startupBehavior);
    await upsertSetting(database, "defaultDownloadsPath", settings.defaultDownloadsPath);
    await upsertSetting(database, "adBlockingEnabled", settings.adBlockingEnabled ? "true" : "false");
  });
}

// ---------------------------------------------------------------------------
// Extension: Netflix auto-skip
// ---------------------------------------------------------------------------

export type NetflixExtensionSettings = {
  skipRecap: boolean;
  skipIntro: boolean;
  nextEpisode: boolean;
};

export const DEFAULT_NETFLIX_SETTINGS: NetflixExtensionSettings = {
  skipRecap: true,
  skipIntro: true,
  nextEpisode: true,
};

export async function loadNetflixSettings(): Promise<NetflixExtensionSettings> {
  const database = await getDb();
  const rows = await database.select<Array<{ key: string; value: string }>>(
    "SELECT key, value FROM settings WHERE key IN ('netflix_skipRecap','netflix_skipIntro','netflix_nextEpisode')",
  );
  const out = { ...DEFAULT_NETFLIX_SETTINGS };
  for (const r of rows) {
    if (r.key === "netflix_skipRecap") out.skipRecap = r.value === "true";
    else if (r.key === "netflix_skipIntro") out.skipIntro = r.value === "true";
    else if (r.key === "netflix_nextEpisode") out.nextEpisode = r.value === "true";
  }
  return out;
}

export async function saveNetflixSettings(s: NetflixExtensionSettings): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await upsertSetting(database, "netflix_skipRecap", s.skipRecap ? "true" : "false");
    await upsertSetting(database, "netflix_skipIntro", s.skipIntro ? "true" : "false");
    await upsertSetting(database, "netflix_nextEpisode", s.nextEpisode ? "true" : "false");
  });
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

async function insertBookmark(database: SqliteDatabase, bm: Bookmark): Promise<void> {
  await database.execute(
    `INSERT OR REPLACE INTO bookmarks (id, title, url, created_at)
     VALUES ($1, $2, $3, $4)`,
    [bm.id, bm.title, bm.url, bm.createdAt],
  );
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  const database = await getDb();
  const rows = await database.select<
    Array<{ id: string; title: string; url: string; created_at: number }>
  >("SELECT id, title, url, created_at FROM bookmarks ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    createdAt: r.created_at,
  }));
}

export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("DELETE FROM bookmarks");
    for (const b of bookmarks) {
      await insertBookmark(database, b);
    }
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function insertHistory(database: SqliteDatabase, entry: HistoryEntry): Promise<void> {
  await database.execute(
    "INSERT INTO history (url, title, visited_at) VALUES ($1, $2, $3)",
    [entry.url, entry.title, entry.visitedAt],
  );
}

const HISTORY_LIMIT = 500;

export async function loadHistory(): Promise<HistoryEntry[]> {
  const database = await getDb();
  const rows = await database.select<
    Array<{ url: string; title: string; visited_at: number }>
  >(`SELECT url, title, visited_at FROM history ORDER BY visited_at DESC LIMIT ${HISTORY_LIMIT}`);
  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    visitedAt: r.visited_at,
  }));
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    // #region DEBUG
    await debugLog(`[DEBUG H2] appendHistory start url=${entry.url}`);
    // #endregion DEBUG
    const existing = await database.select<Array<{ id: number; title: string; visited_at: number }>>(
      "SELECT id, title, visited_at FROM history WHERE url = $1 ORDER BY visited_at DESC LIMIT 1",
      [entry.url],
    );

    if (existing.length > 0) {
      await database.execute(
        "UPDATE history SET title = $1, visited_at = $2 WHERE id = $3",
        [entry.title || existing[0].title, entry.visitedAt, existing[0].id],
      );
    } else {
      await insertHistory(database, entry);
    }

    const count = await database.select<[{ count: number }]>("SELECT COUNT(*) AS count FROM history");
    if (count[0].count > HISTORY_LIMIT) {
      await database.execute(
        `DELETE FROM history WHERE id NOT IN (
           SELECT id FROM history ORDER BY visited_at DESC LIMIT ${HISTORY_LIMIT}
         )`,
      );
    }
    // #region DEBUG
    await debugLog(`[DEBUG H2] appendHistory end url=${entry.url}`);
    // #endregion DEBUG
  });
}

export async function clearHistory(): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    // #region DEBUG
    await debugLog(`[DEBUG H2] clearHistory start`);
    // #endregion DEBUG
    await database.execute("DELETE FROM history");
    // #region DEBUG
    await debugLog(`[DEBUG H2] clearHistory end`);
    // #endregion DEBUG
  });
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("DELETE FROM history");
    for (const entry of entries) {
      await insertHistory(database, entry);
    }
  });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function insertDownload(database: SqliteDatabase, dl: DownloadEntry): Promise<void> {
  await database.execute(
    `INSERT OR REPLACE INTO downloads_v2 (
       id, filename, url, destination, total_bytes, received_bytes, state, started_at, completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      dl.id,
      dl.filename,
      dl.url,
      dl.destination || null,
      dl.totalBytes,
      dl.receivedBytes,
      dl.state || (dl.completed ? "completed" : "in_progress"),
      dl.startedAt || dl.createdAt,
      dl.completedAt || (dl.completed ? dl.createdAt : 0),
    ],
  );
}

export async function upsertDownload(dl: DownloadEntry): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await insertDownload(database, dl);
  });
}

export async function pauseDownload(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("UPDATE downloads_v2 SET state = 'paused' WHERE id = $1", [id]);
  });
}

export async function resumeDownload(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("UPDATE downloads_v2 SET state = 'in_progress' WHERE id = $1", [id]);
  });
}

export async function cancelDownload(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("UPDATE downloads_v2 SET state = 'cancelled' WHERE id = $1", [id]);
  });
}

export async function retryDownload(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute(
      "UPDATE downloads_v2 SET state = 'in_progress', received_bytes = 0 WHERE id = $1",
      [id],
    );
  });
}

export async function deleteDownload(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads_v2 WHERE id = $1", [id]);
  });
}

export async function loadDownloads(): Promise<DownloadEntry[]> {
  const database = await getDb();
  const rows = await database.select<
    Array<{
      id: string;
      filename: string;
      url: string;
      destination: string | null;
      total_bytes: number;
      received_bytes: number;
      state: string;
      started_at: number;
      completed_at: number;
    }>
  >("SELECT * FROM downloads_v2 ORDER BY started_at DESC");

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    url: r.url,
    destination: r.destination || undefined,
    totalBytes: r.total_bytes,
    receivedBytes: r.received_bytes,
    completed: r.state === "completed",
    state: r.state as DownloadEntry["state"],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.started_at,
  }));
}

export async function saveDownloads(downloads: DownloadEntry[]): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads_v2");
    for (const d of downloads) {
      await insertDownload(database, d);
    }
  });
}

// ---------------------------------------------------------------------------
// Secure Storage (OS-Backed DPAPI Encryption)
// ---------------------------------------------------------------------------

export async function storeSecureSecret(key: string, plaintext: string): Promise<void> {
  const ciphertext: string = await invoke("encrypt_secret", { plaintext });
  return enqueueWrite(async () => {
    const database = await getDb();
    // #region DEBUG
    await debugLog(`[DEBUG H2] storeSecureSecret start key=${key}`);
    // #endregion DEBUG
    await database.execute(
      `INSERT OR REPLACE INTO secure_vault (key, ciphertext, created_at, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [key, ciphertext, Date.now(), Date.now()],
    );
    // #region DEBUG
    await debugLog(`[DEBUG H2] storeSecureSecret end key=${key}`);
    // #endregion DEBUG
  });
}

export async function retrieveSecureSecret(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<Array<{ ciphertext: string }>>(
    "SELECT ciphertext FROM secure_vault WHERE key = $1",
    [key],
  );
  if (!rows.length || !rows[0].ciphertext) return null;
  return await invoke<string>("decrypt_secret", { ciphertextHex: rows[0].ciphertext });
}

export async function deleteSecureSecret(key: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await getDb();
    // #region DEBUG
    await debugLog(`[DEBUG H2] deleteSecureSecret start key=${key}`);
    // #endregion DEBUG
    await database.execute("DELETE FROM secure_vault WHERE key = $1", [key]);
    // #region DEBUG
    await debugLog(`[DEBUG H2] deleteSecureSecret end key=${key}`);
    // #endregion DEBUG
  });
}

// ---------------------------------------------------------------------------
// Storage Diagnostics
// ---------------------------------------------------------------------------

export type StorageDiagnosticsResult = {
  dbStatus: "connected" | "error";
  error?: string;
  latencyMs: number;
  tables: Record<string, number>;
  encryptionWorking: boolean;
};

export async function runStorageDiagnostics(): Promise<StorageDiagnosticsResult> {
  const start = performance.now();
  try {
    const database = await getDb();

    // 1. Table row counts
    const tableNames = [
      "workspaces",
      "tab_groups",
      "tabs_v2",
      "sidebar_state",
      "session_state",
      "bookmarks",
      "history",
      "downloads_v2",
      "secure_vault",
      "closed_tabs",
    ];
    const tables: Record<string, number> = {};
    for (const table of tableNames) {
      try {
        const rows = await database.select<[{ count: number }]>(
          `SELECT COUNT(*) as count FROM ${table}`,
        );
        tables[table] = rows[0]?.count ?? 0;
      } catch {
        tables[table] = -1;
      }
    }

    // 2. Round-trip test
    const testKey = `__diag_${Date.now()}`;
    await database.execute(
      "INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES ($1, $2, $3)",
      [testKey, "diagnostic_ok", Date.now()],
    );
    const readBack = await database.select<Array<{ value: string }>>(
      "SELECT value FROM session_state WHERE key = $1",
      [testKey],
    );
    await database.execute("DELETE FROM session_state WHERE key = $1", [testKey]);

    const readSuccess = readBack.length > 0 && readBack[0].value === "diagnostic_ok";

    // 3. Vault DPAPI test
    let encryptionWorking = true;
    try {
      await storeSecureSecret("__diag_vault__", "vault_test_payload");
      const decrypted = await retrieveSecureSecret("__diag_vault__");
      await deleteSecureSecret("__diag_vault__");
      encryptionWorking = decrypted === "vault_test_payload";
    } catch {
      encryptionWorking = false;
    }

    const duration = Math.round((performance.now() - start) * 10) / 10;

    devConsole.persistence({
      entity: "system",
      state: readSuccess ? "db_committed" : "db_failed",
      stage: "database",
      action: "DIAGNOSTIC_CHECK",
      description: `Storage diagnostics completed in ${duration}ms. Read-write verify: ${
        readSuccess ? "PASS" : "FAIL"
      }. DPAPI Vault: ${encryptionWorking ? "PASS" : "FAIL"}.`,
      durationMs: duration,
      details: { tables, readSuccess, encryptionWorking },
    });

    return {
      dbStatus: "connected",
      latencyMs: duration,
      tables,
      encryptionWorking,
    };
  } catch (err) {
    const duration = Math.round((performance.now() - start) * 10) / 10;
    const msg = err instanceof Error ? err.message : String(err);
    devConsole.persistence({
      entity: "system",
      state: "db_failed",
      stage: "database",
      action: "DIAGNOSTIC_CHECK",
      description: `Storage diagnostics failed after ${duration}ms: ${msg}`,
      durationMs: duration,
      error: err as Error,
    });
    return {
      dbStatus: "error",
      error: msg,
      latencyMs: duration,
      tables: {},
      encryptionWorking: false,
    };
  }
}

