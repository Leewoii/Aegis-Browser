# Aegis Browser

A desktop browser built with Tauri 2, React 18, and Rust. Web content renders in native OS webviews, not iframes. Browser state persists locally in SQLite.

## Features

### Tabs & Workspaces

- Persistent tab sessions restored on startup (previous session or fresh home tab)
- Tab groups with color labels and collapse state
- Drag-and-drop tab reorder
- Group auto-dissolve when only one tab remains
- Close other tabs, close tabs to the right, duplicate tab
- Closed tabs recorded for undo support
- Three default workspaces: Personal, Development, Cybersecurity
- Create custom workspaces with name, icon, and color
- Workspace-specific profile directories (isolated cookies/storage per workspace)
- Clear workspace profile data from settings

### Sidebar & Panels

- Collapsible left sidebar that expands on hover or pins open
- Docked side panels for Bookmarks, History, Downloads, Settings, and Scratchpad notes
- Embedded web-app panels: Messenger, WhatsApp, ChatGPT, Twitch, Spotify
- Each web-app panel runs in its own native webview with isolated profile
- Panel resize via drag handle (220-600px)
- Pin/unpin panels; unpinned panels auto-hide on outside click
- Mute/unmute audio for individual web-app panels

### Navigation

- Back/forward per-tab history
- Reload with fallback to webview recreation
- Omnibox with search suggestions from history and bookmarks
- Search engine selection: DuckDuckGo, Google, or Bing
- Domain-like input auto-prefixed with `https://`
- Voice search via SpeechRecognition API
- QR code scanning from image files (jsQR)
- Cross-origin links from any webview open in a new tab automatically
- Same-site navigation allowed in place; redirects supported with a 5-second window
- Sensitive URL query params (tokens, keys, passwords) redacted from logs

### Security

- OS-level encryption on Windows via DPAPI (`CryptProtectData`/`CryptUnprotectData`)
- Scratchpad notes stored encrypted in a local vault
- Saved credentials stored encrypted in the same vault
- Non-Windows builds fall back to a placeholder XOR cipher (not production-safe)

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd+L | Focus omnibox |
| Ctrl/Cmd+T | New tab |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+R | Reload |
| Alt+Left | Back |
| Alt+Right | Forward |

### Context Menus

- Right-click on a tab: reload, duplicate, group, close, close others, close to the right
- Right-click on a group: rename, ungroup, close group
- Right-click on the page: new tab, copy page URL
- Right-click on links inside webviews: open in new tab, open in current tab, copy link address

### Settings

- Three themes: Dark, AMOLED, Nord
- Search engine preference
- Custom home screen greeting
- Startup behavior: restore previous session or open home tab
- Downloads folder path
- Ad/tracker shield toggle (UI present; blocking logic not yet implemented)

### Window

- Frameless transparent window on Windows
- Custom minimize/maximize/close buttons
- Drag to move via title bar
- Window size and position remembered across sessions
- Loading bar during page loads

## Tech Stack

- [Tauri v2](https://tauri.app/) with native child webviews
- React 18 + TypeScript (strict mode)
- Vite 8
- Rust backend with navigation gating plugin, DPAPI encryption, and IPC commands
- SQLite via `@tauri-apps/plugin-sql`
- lucide-react for icons

## Scripts

```
npm run dev          # Vite dev server on 127.0.0.1:5173
npm run build        # Type-check + production build
npm run preview      # Preview production build
npm run tauri:dev    # Desktop app in dev mode
npm run tauri:build  # Build desktop installer (MSI + NSIS)
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier check
npm run format:fix   # Prettier write
```

## Project Structure

```
src/
  App.tsx                    Root component, all browser orchestration
  main.tsx                   React mount point
  types.ts                   Domain types
  components/
    TabStrip.tsx             Tab bar with drag reorder and grouped chips
    ChromeActions.tsx        Toolbar quick-action buttons
    Omnibox.tsx              Address bar with suggestions
    HomeScreen.tsx           New-tab page with search
    Sidebar.tsx              Left sidebar with panel launchers
    CreateWorkspaceModal.tsx Workspace creation dialog
    Toasts.tsx               Notification toasts
    Favicon.tsx, Logo.tsx, Icons.tsx, AiEmblem.tsx
    panels/
      PanelHost.tsx          Panel router and webview container
      BookmarksPanel.tsx     Bookmark list and add form
      HistoryPanel.tsx       Browsing history grouped by day
      DownloadsPanel.tsx     Download list with state badges
      SettingsPanel.tsx      Preferences and privacy controls
      NotesPanel.tsx         Encrypted scratchpad
  hooks/
    useWebviewManager.ts     Native webview lifecycle and layout sync
    useKeyboardShortcuts.ts  Global shortcut bindings
    useVoiceSearch.ts        Speech recognition integration
    useQrScan.ts             QR code file reader
    useToasts.ts             Toast notification state
  services/
    storage.ts               SQLite persistence, migrations, secure vault
    downloads.ts             Download state manager (simulated progress)
    debug.ts                 Debug log channel to file
  constants/
    webApps.ts               Embedded web-app panel URLs
    panels.ts                Legacy duplicate of webApps constants
  utils/
    browser.ts               Tab factories, URL normalization, defaults
    format.ts                Byte/time/date formatting helpers
  styles/
    tokens.css               Design tokens, theme variables
    base.css                 Reset and base styles
    layout.css               App shell and structural layout
    components.css           Widget and panel styling
src-tauri/
  src/
    lib.rs                   Tauri builder, plugin and command registration
    main.rs                  Binary entry point
    commands.rs              IPC commands (navigation, muting, profiles, debug)
    navigation.rs            Navigation gating plugin with redirect/debounce logic
    injection.rs             JavaScript injected into child webviews
    security.rs              DPAPI encrypt/decrypt commands
  capabilities/
    default.json             Tauri permission declarations
  tauri.conf.json            Window, bundle, and CSP configuration
  Cargo.toml                 Rust dependencies
```

## Storage

All browser state is stored in a local SQLite database (`silentx.db`). No cloud sync. Data stays on the local machine per user profile. Tabs, bookmarks, history, downloads, settings, workspace definitions, sidebar state, window geometry, and closed-tab records are all persisted. Encrypted data (notes, credentials) is stored in a `secure_vault` table with OS-level encryption on Windows.

## Build Targets

Bundles are produced as MSI and NSIS installers for Windows.

## License

No license file is currently included in this repository.
