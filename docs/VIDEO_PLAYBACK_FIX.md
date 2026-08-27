# Video Playback Fix Notes

## Problem

Some streaming pages, especially Netflix and Crunchyroll, were opening but not rendering video correctly inside Aegis Browser.

Observed symptoms included:

- Audio playing while the video area stayed black or frozen
- The page loading, but the player not refreshing properly
- Player behavior becoming unstable after navigation or reloads

The issue was not in the React UI. It was happening in the native WebView2 host layer and in the injected navigation script used by the browser tabs.

## Root Cause

Two backend behaviors could interfere with protected video pages:

1. WebView2 was using the default GPU compositor path, which can cause presentation issues for some video-heavy pages on Windows.
2. Aegis injects navigation helper JavaScript into child webviews so links, shortcuts, and new-tab actions work consistently. That script is useful for normal browsing, but it should not run on protected streaming pages because those pages depend on their own media and popup behavior.

## Fix

### 1. Enabled media-friendly WebView2 runtime arguments

In `src-tauri/src/lib.rs`, the Windows WebView2 runtime is launched with additional browser arguments that favor streaming playback:

- `WidevineCdm`
- `MediaFoundationPlayback`
- `HardwareMediaKeyHandling`
- `EncryptedMedia`
- `--autoplay-policy=no-user-gesture-required`
- `--disable-features=TrackingPrevention`
- `--disable-gpu-compositing`

The important part for the black-frame / stale-frame issue is `--disable-gpu-compositing`, which routes page compositing away from the problematic GPU presentation path.

### 2. Skipped script injection on protected streaming hosts

In `src-tauri/src/navigation.rs`, the navigation injection helper now skips top-level pages from:

- `netflix.com`
- `crunchyroll.com`

That means the browser still keeps its custom navigation behavior for normal sites, but does not inject the helper script into those streaming pages.

This matters because the injected script overrides browser behaviors such as:

- `window.open`
- link interception
- shortcut forwarding
- page-title reporting

Those behaviors are useful for tabs, but they can conflict with DRM or player logic on streaming sites.

## Files Changed

- `src-tauri/src/lib.rs`
- `src-tauri/src/navigation.rs`

## Result

After the fix:

- Netflix and Crunchyroll were no longer forced through the browser helper injection
- WebView2 used the safer compositing path for video playback
- The browser kept its normal tab behavior for the rest of the web

## Notes

This is a backend compatibility fix, not a UI change.

If other protected media sites show the same issue later, they may need to be added to the protected-host list in `src-tauri/src/navigation.rs`.
