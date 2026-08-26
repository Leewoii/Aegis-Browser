import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

import type { PanelId, Tab, ToastType } from "../types";
import { isWebAppPanel } from "../types";
import { WEB_APP_PANELS } from "../constants/webApps";
import { debugLog } from "../services/debug";

const RESIZE_RAF_DEBOUNCE = 0;

interface WebviewManagerOptions {
  contentRef: React.RefObject<HTMLDivElement | null>;
  panelContentRef: React.RefObject<HTMLDivElement | null>;
  getActiveTab: () => Tab | null;
  activePanelRef: React.MutableRefObject<PanelId | null>;
  isOverlayActiveRef?: React.MutableRefObject<boolean>;
  showToast: (message: string, type?: ToastType) => void;
}

async function waitForWebviewCreated(view: Webview, retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("webview creation timeout")), 10000);
        view.once("tauri://created", () => {
          clearTimeout(timeout);
          resolve();
        });
        view.once("tauri://error", (event) => {
          clearTimeout(timeout);
          reject(event.payload);
        });
      });
      return;
    } catch (err) {
      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.warn(`Webview creation attempt ${attempt + 1} failed, retrying in ${delay}ms:`, err);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

export function useWebviewManager(options: WebviewManagerOptions) {
  const {
    contentRef,
    panelContentRef,
    getActiveTab,
    activePanelRef,
    isOverlayActiveRef,
    showToast,
  } = options;

  const tabWebviewsRef = useRef<Record<string, Webview>>({});
  const panelWebviewRef = useRef<Webview | null>(null);
  const panelWebviewPanelRef = useRef<PanelId | null>(null);
  const pendingRafRef = useRef<number | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncQueuedRef = useRef(false);
  const creatingTabIdsRef = useRef<Set<string>>(new Set());

  // ── Tab webviews ──────────────────────────────────────────────────

  const destroyTabWebview = useCallback(async (tabId: string) => {
    const wv = tabWebviewsRef.current[tabId];
    if (!wv) return;
    delete tabWebviewsRef.current[tabId];
    try {
      // #region DEBUG
      await debugLog(`[DEBUG H3] destroyTabWebview start tabId=${tabId}`);
      // #endregion DEBUG
      await wv.close();
      // #region DEBUG
      await debugLog(`[DEBUG H3] destroyTabWebview end tabId=${tabId}`);
      // #endregion DEBUG
    } catch (err) {
      // #region DEBUG
      await debugLog(`[DEBUG H3] destroyTabWebview failed tabId=${tabId} err=${err instanceof Error ? err.message : String(err)}`);
      // #endregion DEBUG
      console.error("Failed to close webview for tab", tabId, err);
    }
  }, []);

  async function createTabWebview(
    tab: Tab,
    left: number,
    top: number,
    width: number,
    height: number,
  ): Promise<void> {
    if (tabWebviewsRef.current[tab.id] || creatingTabIdsRef.current.has(tab.id)) {
      return;
    }
    creatingTabIdsRef.current.add(tab.id);
    try {
      // #region DEBUG
      await debugLog(`[DEBUG H3] createTabWebview start tabId=${tab.id} label=${tab.label} url=${tab.url}`);
      // #endregion DEBUG
      const wsId = tab.workspaceId || "personal";
      await invoke("allow_navigation", { label: tab.label, url: tab.url });
      const view = new Webview(getCurrentWindow(), tab.label, {
        url: tab.url,
        x: left,
        y: top,
        width,
        height,
        focus: true,
        dataDirectory: `profiles/workspace_${wsId}`,
      });
      await waitForWebviewCreated(view);
      tabWebviewsRef.current[tab.id] = view;
      // #region DEBUG
      await debugLog(`[DEBUG H3] createTabWebview end tabId=${tab.id} label=${tab.label}`);
      // #endregion DEBUG
    } catch (err) {
      // #region DEBUG
      await debugLog(`[DEBUG H3] createTabWebview failed tabId=${tab.id} label=${tab.label} err=${err instanceof Error ? err.message : String(err)}`);
      // #endregion DEBUG
      console.error("Failed to create webview for tab", tab.id, err);
      showToast(`Failed to load ${tab.title}`, "error");
    } finally {
      creatingTabIdsRef.current.delete(tab.id);
    }
  }

  // ── Panel webviews ────────────────────────────────────────────────

  const destroyPanelWebview = useCallback(async () => {
    const current = panelWebviewRef.current;
    panelWebviewRef.current = null;
    panelWebviewPanelRef.current = null;
    if (!current) return;
    try {
      await current.close();
    } catch (err) {
      console.error("Failed to close panel webview:", err);
    }
  }, []);

  async function syncPanelWebview(): Promise<void> {
    const active = activePanelRef.current;
    const url = active && isWebAppPanel(active) ? WEB_APP_PANELS[active] : undefined;

    if (!url) {
      await destroyPanelWebview();
      return;
    }

    const container = panelContentRef.current;
    if (!container) return;
    const rawRect = container.getBoundingClientRect();
    if (rawRect.width <= 0 || rawRect.height <= 0) return;

    if (isOverlayActiveRef?.current) {
      if (panelWebviewRef.current) await panelWebviewRef.current.hide();
      return;
    }

    // Round outward to prevent sub-pixel bleeding
    const pLeft = Math.ceil(rawRect.left);
    const pTop = Math.ceil(rawRect.top);
    const pWidth = Math.floor(rawRect.right) - pLeft;
    const pHeight = Math.floor(rawRect.bottom) - pTop;
    if (pWidth <= 0 || pHeight <= 0) return;

    const label = `silentx-panel-${active}`;
    const needsRecreate =
      !panelWebviewRef.current || panelWebviewPanelRef.current !== active;

    if (needsRecreate) {
      await destroyPanelWebview();
      await invoke("allow_navigation", { label, url });
      const view = new Webview(getCurrentWindow(), label, {
        url,
        x: pLeft,
        y: pTop,
        width: pWidth,
        height: pHeight,
        focus: false,
        dataDirectory: `profiles/panel_${active}`,
      });
      await waitForWebviewCreated(view);
      panelWebviewRef.current = view;
      panelWebviewPanelRef.current = active;
      return;
    }

    const current = panelWebviewRef.current;
    if (!current) return;
    await current.setPosition(new LogicalPosition(pLeft, pTop));
    await current.setSize(new LogicalSize(pWidth, pHeight));
    await current.show();
  }

  // ── Combined sync ─────────────────────────────────────────────────

  const syncActive = useCallback(async (): Promise<void> => {
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    const run = async () => {
      const tab = getActiveTab();
      // #region DEBUG
      await debugLog(
        `[DEBUG H3] syncActive start tab=${tab?.id ?? "none"} kind=${tab?.kind ?? "none"} overlay=${Boolean(isOverlayActiveRef?.current)} tabViews=${Object.keys(tabWebviewsRef.current).length}`,
      );
      // #endregion DEBUG

      // Hide ALL inactive tab webviews, not just the previous one.
      // This prevents stale native HWNDs from bleeding through sidebar/panels.
      for (const [id, wv] of Object.entries(tabWebviewsRef.current)) {
        if (id !== tab?.id) {
          try {
            await wv.hide();
          } catch {
            // webview already gone
          }
        }
      }

      const container = contentRef.current;
      if (!tab || tab.kind !== "web" || !container) {
        await syncPanelWebview();
        return;
      }

      const existingWv = tabWebviewsRef.current[tab.id];

      if (isOverlayActiveRef?.current) {
        if (existingWv) {
          try {
            await existingWv.hide();
          } catch {
            // ignore already hidden
          }
        }
        await syncPanelWebview();
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        await syncPanelWebview();
        return;
      }

      // Round outward to prevent sub-pixel bleeding over sidebar/chrome borders
      const left = Math.ceil(rect.left);
      const top = Math.ceil(rect.top);
      const width = Math.floor(rect.right) - left;
      const height = Math.floor(rect.bottom) - top;

      if (width <= 0 || height <= 0) {
        await syncPanelWebview();
        return;
      }

      if (!existingWv) {
        await createTabWebview(tab, left, top, width, height);
      } else {
        try {
          await existingWv.setPosition(new LogicalPosition(left, top));
          await existingWv.setSize(new LogicalSize(width, height));
          await existingWv.show();
        } catch (err) {
          console.error("Failed to reposition webview:", err);
        }
      }

      await syncPanelWebview();
    };

    syncInFlightRef.current = run().finally(() => {
      syncInFlightRef.current = null;
    });
    await syncInFlightRef.current;
    if (syncQueuedRef.current) {
      syncQueuedRef.current = false;
      await syncActive();
    }
  }, [contentRef, panelContentRef, activePanelRef, isOverlayActiveRef]);

  const scheduleSyncActive = useCallback(() => {
    if (pendingRafRef.current !== null && pendingRafRef.current !== RESIZE_RAF_DEBOUNCE) {
      cancelAnimationFrame(pendingRafRef.current);
    }
    pendingRafRef.current = requestAnimationFrame(() => {
      pendingRafRef.current = null;
      void syncActive();
    });
  }, [syncActive]);

  /** Hide the active tab's webview and panel webviews so HTML overlays (e.g. suggestions, modals) render above them. */
  const hideActiveWebview = useCallback(async () => {
    for (const wv of Object.values(tabWebviewsRef.current)) {
      try {
        await wv.hide();
      } catch {
        // webview already gone
      }
    }
    if (panelWebviewRef.current) {
      try {
        await panelWebviewRef.current.hide();
      } catch {
        // panel webview already gone
      }
    }
  }, []);

  /** Destroy and recreate the given tab's webview (used for hard reload). */
  const recreateTabWebview = useCallback(
    async (tab: Tab) => {
      await destroyTabWebview(tab.id);
      scheduleSyncActive();
    },
    [destroyTabWebview, scheduleSyncActive],
  );

  const destroyAll = useCallback(() => {
    for (const id of Object.keys(tabWebviewsRef.current)) {
      void destroyTabWebview(id);
    }
    void destroyPanelWebview();
  }, [destroyTabWebview, destroyPanelWebview]);

  useEffect(() => destroyAll, [destroyAll]);

  return {
    destroyTabWebview,
    recreateTabWebview,
    destroyPanelWebview,
    syncActive,
    scheduleSyncActive,
    syncPanelOnly: syncPanelWebview,
    hideActiveWebview,
  };
}
