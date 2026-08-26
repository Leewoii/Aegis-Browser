# Aegis Browser — Documentation

Verified against source code on 2026-08-26. Every statement below was checked against the actual files; nothing is speculative. File references use `path:line` where useful.

---

## 1. Identity & Stack

| Field | Value | Source |
|---|---|---|
| Product name | `Aegis Browser` | `package.json:2`, `src-tauri/tauri.conf.json:3` |
| Version | `2.0.0` (JS + Rust + bundle) | `package.json:4`, `src-tauri/Cargo.toml:3`, `tauri.conf.json:4` |
| Identifier | `com.silentx.browser.v2` | `tauri.conf.json:5` |
| Rust crate | `silentx-browser`, lib name `app_lib` | `Cargo.toml:2,12` |
| Publisher / copyright | `Aegis` / `Copyright (c) 2026 Aegis` | `tauri.conf.json:49-50` |

Stack:

- **Frontend**: React 18.3 + TypeScript 5.5 (strict), Vite 8, lucide-react icons, jsqr
- **Desktop shell**: Tauri 2.11 (`unstable` feature enabled — required for child webviews), `@tauri-apps/api` 2.11
- **Backend**: Rust 2021 edition, min rustc 1.77.2
- **Storage**: `tauri-plugin-sql` 2.4 with SQLite feature
- **Release profile**: `panic="abort"`, `strip=true`, LTO, 1 codegen unit (`Cargo.toml:25-29`)
- **Bundle targets**: MSI + NSIS (`tauri.conf.json:38`)

## 2. Window Configuration

From `tauri.conf.json:13-30`:

- Single window labeled `main`, 1440×920 default, min 1024×720, centered
- `decorations: false`, `transparent: true`, `shadow: false`, background `#00000000`
- `main.tsx:11-18` re-applies transparent background at runtime for both window and webview
- CSP (`tauri.conf.json:32`): scripts from self/inline/duckduckgo/google/bing; `img-src https:` + data/blob; `connect-src 'self' https:`; `frame-src 'self' https:`; `object-src 'none'`

Capabilities (`src-tauri/capabilities/default.json`) apply only to `main`: core defaults, window controls (close/minimize/maximize/set-size/set-position/start-dragging/destroy), webview create/close/show/hide/set-position/set-size, native menus, and SQL execute.

## 3. Repository Layout

```
src/
  App.tsx                  # root component, all browser orchestration (1482 lines)
  main.tsx                 # React mount + transparent background init
  types.ts                 # domain types, PanelId union, PANEL_TITLES
  components/
    TabStrip.tsx           # tabs, drag reorder/group, grouped chips
    TabGroupContextMenu.tsx
    ChromeActions.tsx      # toolbar quick actions
    Omnibox.tsx            # address bar + useSuggestions hook
    HomeScreen.tsx         # new-tab page
    Sidebar.tsx            # collapsible/pinnable left sidebar (forwardRef)
    ContextMenu.tsx        # ContextMenuData type (native menu descriptors)
    CreateWorkspaceModal.tsx
    Toasts.tsx, Favicon.tsx, Logo.tsx, AiEmblem.tsx, Icons.tsx
    panels/
      PanelHost.tsx        # PanelContent switch + PanelHeader
      BookmarksPanel.tsx, HistoryPanel.tsx, DownloadsPanel.tsx,
      SettingsPanel.tsx, NotesPanel.tsx
  hooks/
    useWebviewManager.ts   # native webview lifecycle (core of the browser)
    useKeyboardShortcuts.ts, useVoiceSearch.ts, useQrScan.ts, useToasts.ts
  services/
    storage.ts             # SQLite persistence + migrations (1169 lines)
    downloads.ts           # DownloadManager singleton
    debug.ts               # debug_log IPC wrapper (hard-enabled)
  constants/
    webApps.ts             # WEB_APP_PANELS map
    panels.ts              # DUPLICATE of webApps.ts + legacy defaults
  utils/
    browser.ts             # tab factories, URL normalization, defaults
    format.ts              # formatBytes/formatTime/formatDayGroup
  styles/
    tokens.css, base.css, layout.css, components.css
src-tauri/
  src/
    lib.rs        # builder: plugins + command handler
    commands.rs   # IPC commands
    navigation.rs # silentx-navigation plugin (nav gating)
    injection.rs  # JS injected into child webviews
    security.rs   # DPAPI encrypt/decrypt commands
    main.rs       # entry point
  capabilities/default.json
  tauri.conf.json, Cargo.toml
```

Non-source dirs present: `dist/`, `src-tauri/target/`, `node_modules/`, `.claude/` (debug log output), `src-tauri/gen/`.

## 4. Architecture: How the Browser Renders Pages

The app is **not** an iframe browser. Web content lives in **native Tauri child webviews** layered over the HTML chrome.

### 4.1 Tab webviews — `useWebviewManager.ts`

- One native `Webview` per web tab, created via `new Webview(getCurrentWindow(), tab.label, {...})` (`useWebviewManager.ts:107-115`)
- Labels: `silentx-tab-{id}` for tabs (`utils/browser.ts:107`), `silentx-home-{workspace}` for home tabs (`browser.ts:93`)
- Each webview gets an isolated profile directory: `profiles/workspace_{workspaceId}` (`useWebviewManager.ts:114`)
- Creation is gated by `allow_navigation` first (`:106`), then waits for `tauri://created` with 3 retries and exponential backoff up to 10s timeout each (`waitForWebviewCreated`, `:23-48`)
- `syncActive()` is the central layout sync:
  - Hides **all** inactive tab webviews (prevents stale HWND bleed-through, `:219-227`)
  - Positions/shows the active webview at the viewport container's rect, rounded **outward** (ceil left/top, floor right/bottom) to prevent sub-pixel overlap (`:256-259`)
  - In-flight sync dedupe + queued re-run (`:203-289`)
- Overlay handling: when the omnibox dropdown or workspace modal is open (`isOverlayActive`), all webviews hide so HTML renders above them (`App.tsx:305`, `:678-687`; manager `hideActiveWebview`)
- Sync triggers: active tab change, panel/sidebar state change, ResizeObserver on content, window resize (`App.tsx:661-675`)

### 4.2 Panel webviews

- Only for `isWebAppPanel()` panels — Messenger, WhatsApp, ChatGPT, Twitch, Spotify (`constants/webApps.ts:2-8`, `types.ts:128`)
- Label `silentx-panel-{panelId}`, isolated profile `profiles/panel_{panelId}`, `focus: false` (`useWebviewManager.ts:172-187`)
- Destroyed and recreated when switching between web-app panels; repositioned+shown otherwise (`:176-198`)

### 4.3 Muting

`set_webview_muted` (`commands.rs:61-82`) evals JS in the matching child webview that sets `el.muted` and pauses all `<audio>`/`<video>` elements. Wired to per-panel mute state in `App.tsx:1144-1158` (persisted in `mutedPanels`).

## 5. Navigation Gating — `navigation.rs`

Custom plugin `silentx-navigation` built via `PluginBuilder` (`navigation.rs:86`). `on_navigation` handler decides allow/deny for every navigation in child webviews:

1. **`main` label always allowed** (`:92-94`)
2. **Internal signals denied but processed**:
   - `sx-internal://user-click` → emits `silentx-tab-pointerdown` to main (closes unpinned panel/sidebar) (`:97-102`)
   - `sx-internal://open-new-tab?url=...` → emits `silentx-open-link` with the target URL (`:105-116`)
3. **Redirect window**: after a frontend-initiated nav, any navigation within **5 s** is allowed and the timer refreshes (multi-hop redirect chains) (`FRONTEND_NAV_WINDOW :12`, `:121-130`)
4. **Exact-match URL** → allowed (`:132-135`)
5. **Same-host** (host equality ignoring `www.`) → allowed in place; refreshes redirect timer (`:140-150`)
6. **Everything else (cross-origin)** → navigation **denied**, URL emitted to main as `silentx-open-link` which opens a new tab instead; same-URL emits debounced **1500 ms** (`EMIT_DEBOUNCE :13`, `:152-166`)

Page-load events: emits `silentx-page-load-started` / `silentx-page-load-finished {label,url}` and re-injects the interception script into `silentx-tab-*` / `silentx-panel-*` webviews on both Started and Finished (`:168-196`).

Logging: all decisions print `[silentx-nav] ...` with sensitive query params redacted — keys containing token/access_token/refresh_token/auth/password/pass/pwd/key/secret/api_key/code/session/id_token become `[REDACTED]` (`redact_url :16-37`).

### Frontend approval path

- `allow_navigation(label, url)` (`commands.rs:11-21`): rejects schemes outside `http://`, `https://`, `file://`, `data:`; registers the URL as approved
- `navigate_webview(label, url)` (`commands.rs:26-57`): approves + navigates; searches standalone windows then child webviews of `main`
- Back/forward (`switchHistory`, `App.tsx:747-764`) and reload (`reloadActive`, `:769-778`) both call approve→navigate; reload falls back to full webview recreation on failure

## 6. Injected Script — `injection.rs`

Injected into every `silentx-tab-*`/`silentx-panel-*` page load (idempotent via `window.__sxIntercepted`):

1. `window.open(url)` override → routes through new-tab signal (`injection.rs:44-49`)
2. Click capture: Ctrl/Cmd-click, middle-click, `target="_blank"`/`_new` links → prevented and routed to new tab (`:55-72`)
3. Blank-target form submissions serialized into GET-style URLs and routed to new tab (`:75-96`)
4. **In-page custom context menu for links** (dark themed DOM element): "Open link in new tab", "Open link in current tab", "Copy link address"; viewport-aware repositioning; dismissed on outside click/scroll/resize/blur/Escape (`:98-240`)
5. Activity beacon: pointer/click/touch events create a temporary `<a href="sx-internal://user-click?...">` click — this is how clicks inside third-party pages reach `on_navigation` without relying on the Tauri IPC bridge; throttled to 150 ms (`:242-269`)

The design rationale is stated in the file header: avoid depending on `__TAURI__` IPC inside untrusted third-party pages (`injection.rs:1-7`).

## 7. Security — `security.rs`

- Windows: raw FFI to `CryptProtectData` / `CryptUnprotectData` (DPAPI, `CRYPTPROTECT_UI_FORBIDDEN`), Crypt32 linkage, manual `DataBlob` handling with `LocalFree` cleanup (`security.rs:14-128`)
- Non-Windows fallback: single-byte XOR `0x5A` — explicitly a placeholder, **not** secure (`:130-139`)
- Commands: `encrypt_secret(plaintext) -> hex`, `decrypt_secret(hex) -> plaintext` (`:142-161`)

Consumers (verified):
- `NotesPanel.tsx` — scratchpad stored under vault key `scratchpad_notes`, loaded on mount, saved debounced 500 ms (`NotesPanel.tsx:15,35`)
- `SettingsPanel.tsx` — saved credentials under key `saved_credentials` as JSON (`SettingsPanel.tsx:59,82`)

Both route ciphertext into the `secure_vault` table via `storeSecureSecret`/`retrieveSecureSecret`/`deleteSecureSecret` (`storage.ts:1130-1169`).

## 8. Persistence — `storage.ts`

Database: `sqlite:silentx.db` via tauri-plugin-sql, connection cached (`getDb :55-64`).

**Write serialization**: a global promise queue (`globalThis.__silentxStorageState.writeQueue`) serializes ALL writes across the app; each write retries up to 3 times with 150 ms increments on `database is locked`/`SQLITE_BUSY` (`enqueueWrite/retryLockedWrite :66-98`).

### Migrations (`migrateV1ToV2`, `:104-310`)

Creates v2 tables if missing: `workspaces`, `tab_groups`, `tabs_v2`, `sidebar_state`, `session_state`, `closed_tabs`, `secure_vault`, `downloads_v2`. Then one-time data moves (each guarded by target-table emptiness):

- `meta.workspaces` JSON → `workspaces` rows
- `meta.tabGroups` JSON → `tab_groups` rows
- legacy `tabs` rows (history column may be array OR object `{history,group,index}`) → `tabs_v2`
- legacy `downloads` → `downloads_v2` (state derived from `completed` flag)
- Finally marks crashed `in_progress` downloads as `paused` (`:307-309`)

Legacy localStorage migration (`migrateFromLocalStorage :316-406`) runs only when `tabs_v2` is empty; imports tabs/settings/bookmarks/history/downloads then removes the old keys. Keys are defined in `utils/browser.ts:4-11`.

### Tables in use

v1 (legacy/migration sources): `meta`, `tabs`, `settings`, `bookmarks`, `history`, `downloads`
v2 (current): `workspaces`, `tab_groups`, `tabs_v2`, `sidebar_state`, `session_state`, `closed_tabs`, `secure_vault`, `downloads_v2`
Shared: `bookmarks`, `history`, `settings` remain current-use tables.

Note: `lib.rs` registers the SQL plugin **without** bundled migrations (`lib.rs:14`); schema creation/migration lives entirely in frontend `storage.ts`.

### Caps

- History: 500 entries (`HISTORY_LIMIT storage.ts:946`); `appendHistory` upserts by URL (updates title+timestamp) rather than duplicating (`:960-992`)
- Closed tabs: 30 (`:589-594`), supports undo via `loadClosedTabs`/`restoreClosedTab`
- Settings: key/value rows in `settings`; six keys mapped explicitly (`loadSettings/saveSettings :870-898`)

### Debug channel

`debugLog` (frontend `services/debug.ts`, `DEBUG_ENABLED = true`) invokes Rust `debug_log` (`commands.rs:99-113`) which appends to a **hardcoded absolute path** inside the repo: `D:\Users\Frost\Documents\Portfolio\SilentX_V2\.claude\debug.log`. Instrumentation blocks marked `#region DEBUG` exist in `App.tsx`, `useWebviewManager.ts`, and `storage.ts`.

## 9. Download Manager — `downloads.ts`

Singleton class with pub/sub (`subscribe`/`notify`), backed by SQLite persistence functions.

**Important factual note**: progress is **simulated** — a 400 ms interval advances `receivedBytes` by `max(64KB, total/25)` chunks until complete (`downloads.ts:62-84`). No network transfer code exists in the repo; entries behave like real downloads in UI/persistence.

Operations: `startOrResume`, `pause`, `cancel`, `retry` (resets bytes), `delete`, `addDownload`, `clearAll`, and `autoResumePending()` which restarts anything paused/in_progress at startup (`App.tsx:372`). Startup also flips interrupted `in_progress` rows to `paused` (migration step, `storage.ts:307-309`).

DownloadsPanel exposes pause/resume/cancel/retry/delete + clear-all, with state badges completed/downloading/paused/interrupted/cancelled.

## 10. App State & Behavior — `App.tsx`

### State model

Core: `tabs`, `tabGroups`, `workspaces`, `activeWorkspaceId`, `activeTabId`, `query`, `settings`, `bookmarks`, `historyEntries`, `downloads`, `isLoading`.
Chrome: `isSidebarPinned`, `isSidebarHovered`, `activePanel`, `isPanelPinned`, `mutedPanels`, `panelWidth` (resize clamped 220–600 px, `App.tsx:1168`), `isResizing`.

Refs mirror state for event handlers (`activeTabRef`, `tabsRef`, etc.) plus `storageLoadedRef` (blocks saves before initial load completes) and `isClosingRef` (blocks writes during shutdown).

### Startup sequence (`:327-418`)

1. `initializeStorage()` (migrations)
2. Parallel load of 10 datasets: tabs, settings, bookmarks, history, downloads, groups, workspaces, activeWorkspace, sidebarState, windowState
3. `startupBehavior`: `"home"` → fresh home tab in last workspace; `"previous"` → restore persisted tabs/active tab (default `"previous"`)
4. Downloads rehydrated into manager + auto-resume
5. Window size/position/maximized restored (`:385-406`)

Persistence effects debounce tab saves by 200 ms (`:466-472`) and window geometry by 600 ms on resize (`:429-464`). `onCloseRequested` intercepts close, flushes `saveTabs`, then closes (`:514-560`).

### Workspaces

Defaults (`utils/browser.ts:32-36`): Personal (#6e9bff), Development (#a78bfa), Cybersecurity (#34d399). Tab→workspace resolution order: `tab.workspaceId` → parent group's `workspaceId` → `"personal"` (`visibleTabs :131-138`). Empty workspaces get an implicit home tab. `selectWorkspace` switches context, activates first tab or creates home (`:934-956`). Workspace creation via modal (`CreateWorkspaceModal` exports its own color/icon palettes).

Seeded demo tabs (`defaultTabs`, `browser.ts:115-136`): YouTube/Notion/Gmail in collapsed "Essentials" group + Dribbble + home (Personal); GitHub, Stack Overflow (Development); Shodan, Exploit Database (Cybersecurity). Default greeting name: `"Sviatoslav"` (`DEFAULT_SETTINGS :16`).

### Tab groups

Created via selection or native context menu ("Add to New Group", "Move to Group" submenu). Groups auto-dissolve when membership drops to ≤1 (`closeTab :804-816`, `removeTabFromGroup :896-913`). Group actions: rename (window.prompt), ungroup, close group. Default group color `#6e9bff`; palette of 7 colors in `GROUP_COLORS`.

### Native menus vs injected menus

Two distinct systems (do not confuse):
- **Tauri native `Menu` popups** for tab strip / group / page targets, built with `MenuItem`/`Submenu`/`PredefinedMenuItem` (`handleOpenContextMenu :974-1106`)
- The **DOM-based link context menu** inside child webviews from `injection.rs` (section 6)

### Events consumed (`App.tsx:584-657`)

| Event | Effect |
|---|---|
| `silentx-open-link` | creates web tab (from intercepted cross-origin/new-tab requests) |
| `silentx-tab-pointerdown` | closes unpinned panel + unhovers sidebar |
| `silentx-page-load-started` | shows loading bar |
| `silentx-page-load-finished` | hides loading bar; updates matching tab's url/title/per-entry history stack |

Per-tab history is managed app-side (array + index), not via webview back/forward APIs.

### Keyboard shortcuts (`useKeyboardShortcuts.ts`)

Ctrl/Cmd+L focus omnibox · Ctrl/Cmd+T new tab · Ctrl/Cmd+W close tab · Ctrl/Cmd+R reload · Alt+← / Alt+→ back/forward.

### Extras

- Voice search: `SpeechRecognition`/`webkitSpeechRecognition`, en-US, result feeds omnibox (`useVoiceSearch.ts`)
- QR scan: hidden file input, image decoded with jsQR onto canvas, payload fed to omnibox (`useQrScan.ts`)
- Toasts: max 4 visible, 4000 ms lifetime (`useToasts.ts:5-6`)
- Window dragging: frameless window dragged via header regions; interactive elements excluded (`handleStartWindowDrag :1191-1202`); window dots ordered yellow/green/red (minimize/maximize/close, `:1374-1379`)
- Document title follows `Aegis Browser - {tab.title}` (`:691-693`)

## 11. Panels

`PanelHost.PanelContent` switches on `PanelId` (`types.ts:115-126`): bookmarks, downloads, history, settings, notes, workspaces render HTML; chatgpt/twitch/messenger/whatsapp/spotify mount the shared webview container div (native webview positioned over it).

- **Bookmarks**: add form, open (closes unpinned panel first), remove; newest-first
- **History**: grouped by day via `formatDayGroup` ("Today"/"Yesterday"/date), time via `formatTime`; clear-all wipes SQLite + state
- **Downloads**: see section 9
- **Settings**: theme (dark/amoled/nord), search engine (duckduckgo/google/bing), home greeting, startup behavior, downloads folder, ad-blocking toggle; privacy section calls `clear_profile_data` to wipe `profiles/{key}` directories then recreates the active tab webview (`handleClearProfileData App.tsx:958-970`); saved credentials list via secure vault
- **Notes**: DPAPI-backed scratchpad, autosave 500 ms, copy-all, confirm-clear
- Panel chrome: mute toggle (web apps only), pin toggle, close, drag-resize handle

Sidebar behavior: collapsed 52 px / expanded-on-hover 240 px (`tokens.css:24-25`); hover state auto-cancels on outside pointer move/down or window blur; pinned mode disables all auto-hide. Clicks inside any webview (via `sx-internal://user-click` event) collapse unpinned surfaces.

## 12. Types Reference — `types.ts`

- `Tab`: id, kind(`home`|`web`), title, url, label, history[], index, group?, workspaceId?, pinned?, muted?, createdAt?, lastAccessedAt?
- `TabGroup`: id, name, color?, collapsed?, workspaceId?
- `DownloadEntry.state`: `completed | in_progress | paused | failed | cancelled`
- `SearchEngine`: duckduckgo | google | bing; `ThemeName`: dark | amoled | nord
- `Settings`: theme, searchEngine, homeGreeting, startupBehavior(`home`|`previous`), defaultDownloadsPath, adBlockingEnabled
- `PANEL_TITLES` maps all 11 PanelIds to display names

URL normalization (`normalizeInput browser.ts:61-77`): http/https/file pass through; domain-like text gets `https://` prefix (incl. localhost); otherwise search-engine query URL.

## 13. Design System — `styles/`

Load order fixed in `main.tsx:6-9`: tokens → base → layout → components.

- Accents: `--accent-a #6e9bff`, `--accent-b #a78bfa`, `--accent-c #7de3ff`, gradient + glow variants (`tokens.css:5-9`)
- Radii 8/12/18/22 px; chrome height 44 px
- Three themes via `data-theme` attribute (set in `App.tsx:695-697`): `dark` (window #06070c), `amoled` (pure black #000000), `nord` (#20242e with nord accent palette) (`tokens.css:33-78`)
- Visual language: translucent glassy surfaces, blur, neon gradient accents

## 14. Build & Tooling

Scripts (`package.json:6-17`): `dev` (vite @127.0.0.1), `build` (tsc && vite build), `preview`, `tauri:dev`, `tauri:build`, `lint`/`lint:fix` (eslint on src), `format`/`format:fix` (prettier).

- Vite: port 5173 strictPort; watch ignores `src-tauri/target`, `dist`, `node_modules` (cargo lock contention note in config comment); target esnext; no sourcemaps
- TSConfig: strict, ES2022, bundler resolution, noUnusedLocals/Parameters, noEmit, includes `src` only
- ESLint: TypeScript parser + react/prettier configs (`.eslintrc.json`)

Commands used during verification: none modified; docs written from static reads.

## 15. Verified Discrepancies / Code Smells (facts, not opinions about quality)

1. **Duplicate constant modules**: `constants/webApps.ts` and `constants/panels.ts` both define identical `WEB_APP_PANELS` and `HOME_TAB_ID`. `panels.ts` additionally carries a divergent legacy `DEFAULT_SETTINGS` (`sidebarPosition`, greeting `"Welcome back"`) and its own `uid()`. Active code imports from `webApps.ts` and `utils/browser.ts`; `panels.ts` appears unused by current imports.
2. **Hardcoded absolute debug path**: `DEBUG_LOG_PATH` points into this specific user's directory tree (`commands.rs:8`).
3. **Debug logging always on** (`services/debug.ts:3`), including per-navigation writes to disk.
4. **Simulated downloads** (see section 9) — no real transfer implementation.
5. **Non-Windows crypto fallback is XOR** (`security.rs:130-139`) — placeholder only; the app currently targets Windows bundles exclusively (msi/nsis).
6. `Documentation_codex.md` states lib.rs registers "SQL plugin with migrations" versions 1/2 — the current `lib.rs:14` registers the plain SQL plugin with no migration list; all migration logic lives in `storage.ts`.
