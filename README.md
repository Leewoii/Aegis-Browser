# Aegis Browser

A modern desktop browser designed to keep your browsing organized, private, and separated into dedicated workspaces.

Aegis lets you create separate environments for different parts of your life. Keep your **personal browsing, development work, cybersecurity research, and other activities** separated without needing multiple browsers.

It also includes powerful tab management, split-screen browsing, integrated web apps, resumable downloads, a built-in terminal, encrypted notes, and more.

---

## Why Aegis?

Most browsers treat everything as one large browsing session.

Aegis takes a different approach.

You can create separate **Workspaces**, each with its own browsing environment. This means websites, logins, and browsing data from one workspace stay separate from another.

For example:

* **Personal** — social media, shopping, personal accounts
* **Development** — GitHub, documentation, development tools
* **Cybersecurity** — research, labs, security tools and resources
* **Custom** — create your own workspace for anything else

Switching between workspaces gives you a clean environment without mixing your browsing activity together.

---

# Features

## Workspaces

Keep different parts of your digital life separated.

Each workspace has its own browsing environment, allowing you to keep things such as:

* Website logins
* Cookies
* Browsing data
* Local website storage
* Website sessions

separate from other workspaces.

You can also create custom workspaces with your own **name, icon, and color**.

### Example

You could have:

**Personal → Development → Cybersecurity → Projects**

and switch between them whenever you need.

---

## Powerful Tab Management

Aegis is designed for people who regularly work with many tabs.

### Tab Groups

Organize related tabs into groups that can be collapsed and expanded when needed.

For example:

**Cybersecurity**

* PortSwigger
* Hack The Box
* GitHub
* OWASP

**Development**

* Documentation
* Stack Overflow
* GitHub
* Project dashboard

Tabs can be rearranged and moved between groups.

### Split View

Work with two websites side-by-side in the same window.

Drag a tab to the side of the browser and Aegis can turn the workspace into a split view.

Useful for things like:

* Documentation + code
* Research + notes
* Video + website
* Two dashboards
* Comparing websites

---

# Built-in Web Apps

Aegis can keep commonly used web applications available beside your browsing session.

You can use panels for services such as:

* Messenger
* WhatsApp
* ChatGPT
* Twitch
* Spotify

Panels can be resized, pinned, or hidden when you do not need them.

This means you can keep a conversation, music player, or other web application available without constantly switching tabs.

---

# Downloads Built for Large Files

Aegis includes a download system designed for large and interrupted downloads.

Downloads can:

* Use multiple connections when supported
* Resume after being paused
* Continue after interruptions
* Show download speed and progress
* Queue multiple downloads
* Recover unfinished downloads

If a download is interrupted, Aegis can continue from where it stopped instead of starting over.

---

# Built-in Terminal

Aegis includes an integrated terminal panel.

This allows you to keep command-line tools available while browsing.

For example:

**Browser → Documentation → Terminal**

without needing to constantly switch between separate applications.

---

# Notes

Aegis includes a built-in notes area for keeping information while browsing.

You can use it for:

* Research notes
* Temporary information
* Development notes
* Checklists
* Project information

Notes can be stored securely on your computer.

---

# Privacy

Aegis is designed around keeping your browsing data on your own computer.

Your workspace data is kept separately, allowing you to maintain different browsing environments without mixing their data together.

You can also reset an individual workspace without affecting your other workspaces.

### Local Storage

Aegis stores browser state and application data locally rather than requiring a cloud account for basic browser functionality.

---

# Secure Vault

Aegis includes a protected area for sensitive information such as saved credentials and private notes.

On Windows, sensitive vault data can be protected using Windows' built-in security mechanisms.

The goal is simple:

**Your private data should not be casually exposed just because it is stored on your computer.**

---

# Netflix Controls

Aegis includes optional controls for supported Netflix playback features.

These can help automatically handle actions such as:

* Skipping intros
* Skipping recaps
* Moving to the next episode

---

# Developer Console

Aegis includes a built-in diagnostic console for troubleshooting the browser.

It can help identify problems involving:

* Browser features
* Websites
* Downloads
* Updates
* Settings
* Data storage

This is particularly useful when something goes wrong without requiring the user to dig through complicated log files.

---

# Keyboard Shortcuts

| Shortcut       | Action                  |
| -------------- | ----------------------- |
| `Ctrl/Cmd + L` | Focus the address bar   |
| `Ctrl/Cmd + T` | Open a new tab          |
| `Ctrl/Cmd + W` | Close the current tab   |
| `Ctrl/Cmd + R` | Reload the current page |
| `Alt + Left`   | Go back                 |
| `Alt + Right`  | Go forward              |

---

# What Makes Aegis Different?

Aegis is not intended to be another browser with a different theme.

Its focus is on **organization, separation, and power-user workflows**.

### Workspace-based browsing

Instead of putting everything into one browser profile, Aegis lets you maintain separate environments for different activities.

### Browser + workspace tools

Aegis combines browsing with tools that are commonly needed alongside it:

* Web apps
* Split-screen browsing
* Notes
* Terminal
* Downloads
* Diagnostics

### Designed for heavy browsing

Aegis is intended for users who regularly work with many websites, accounts, projects, and tools at the same time.

---

# Screenshots

*Add screenshots or GIFs here.*

Recommended screenshots:

* Main browser window
* Workspace switcher
* Tab groups
* Split view
* Web app panels
* Download manager
* Notes
* Terminal
* Settings
* Dark/light themes

---

# Privacy Philosophy

Aegis follows a simple principle:

> **Your browser should work for you, not require your entire workflow to revolve around it.**

The application is designed to keep important browsing and application data on your computer and give you control over how that data is separated.

---

# Technology

Aegis is built using:

* **Tauri 2**
* **Rust**
* **React**
* **TypeScript**
* **SQLite**
* **WebView2**

Aegis uses native desktop web technologies rather than building the browser around Electron.

The project is designed to provide a desktop application while keeping resource usage lower than traditional Chromium-based desktop shells where possible.

---

# Windows Support

Aegis currently targets **Windows**.

Available builds are provided as:

* MSI installer
* NSIS installer

---

# Development

Clone the repository and install the required dependencies.

```bash
npm install
```

Run the development version:

```bash
npm run tauri:dev
```

Build the application:

```bash
npm run tauri:build
```

Other available commands:

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run lint:fix
npm run format
npm run format:fix
```

---

# Project Status

Aegis is an actively developed project.

Features and behavior may change as development continues.

---

# License

No license file is currently included in this repository.
