# Aegis Browser

Aegis Browser is a Tauri-powered desktop browser built for fast tab switching, workspace separation, and sidebar-based web apps. It combines a Chromium webview with persistent local storage, grouped tabs, bookmarks, history, downloads, and embedded panels.

## Features

- Persistent tab sessions
- Workspace support for separating personal, development, and security browsing
- Tab groups with drag-and-drop organization
- Bookmarks, history, and downloads panels
- Sidebar panels for embedded web apps and tools
- Search engine selection from the omnibox
- Startup behavior control for restoring the previous session or opening the home tab
- Local SQLite-backed storage for browser state

## Tech Stack

- [Tauri v2](https://tauri.app/)
- React 18
- TypeScript
- Vite
- SQLite via `@tauri-apps/plugin-sql`
- Rust backend commands and navigation plugin

## Scripts

- `npm run dev` - start the Vite dev server
- `npm run build` - type-check and build the frontend
- `npm run preview` - preview the frontend build
- `npm run tauri:dev` - run the desktop app in development mode
- `npm run tauri:build` - build the desktop app bundles
- `npm run lint` - lint the TypeScript/React source
- `npm run lint:fix` - auto-fix lint issues where possible
- `npm run format` - check formatting
- `npm run format:fix` - apply formatting

## Persistence

Aegis Browser stores tab/session data locally in SQLite. Each Windows user profile and each machine gets its own local data store. There is no cloud sync in the current implementation, so tabs will not automatically follow you across devices.

## Project Structure

- `src/` - React frontend
- `src/components/` - UI components and panels
- `src/services/` - storage, downloads, and runtime services
- `src/hooks/` - webview and browser logic
- `src-tauri/` - Rust backend, Tauri configuration, and commands

## Notes

- The app uses a transparent frameless window on Windows.
- Default tabs and workspace layout are defined in the frontend source.
- Embedded sidebar panels are used for tools like bookmarks, history, downloads, and web apps.

## License

No license file is currently included in this repository.
