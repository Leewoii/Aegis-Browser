import { useState, useRef, useEffect } from "react";
import { Layers, Plus, X } from "lucide-react";
import type { Tab, TabGroup as TabGroupType } from "../types";
import { HOME_TAB_ID } from "../utils/browser";
import { Favicon } from "./Favicon";
import type { ContextMenuData } from "./ContextMenu";

interface TabStripProps {
  tabs: Tab[];
  activeTabId: string;
  tabGroups: Record<string, TabGroupType>;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onReorderTabs: (newTabs: Tab[]) => void;
  onGroupTabs: (tabIds: string[], groupName?: string) => void;
  onAddTabToGroup: (tabId: string, groupId: string) => void;
  onRemoveTabFromGroup: (tabId: string) => void;
  onOpenContextMenu: (data: ContextMenuData) => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  tabGroups,
  onSwitch,
  onClose,
  onNewTab,
  onReorderTabs,
  onGroupTabs,
  onAddTabToGroup,
  onRemoveTabFromGroup,
  onOpenContextMenu,
}: TabStripProps) {
  // Drag State
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [targetTabId, setTargetTabId] = useState<string | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [isGroupingPreview, setIsGroupingPreview] = useState(false);

  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pendingTabIdRef = useRef<string | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Group consecutive tabs by group id
  type StripItem =
    | { type: "group"; groupId: string; group: TabGroupType; tabs: Tab[] }
    | { type: "tab"; tab: Tab };

  const stripItems: StripItem[] = [];
  let i = 0;
  while (i < tabs.length) {
    const tab = tabs[i];
    if (tab.group) {
      const gId = tab.group;
      const groupInfo: TabGroupType = tabGroups[gId] || {
        id: gId,
        name: gId.charAt(0).toUpperCase() + gId.slice(1),
        color: "#6e9bff",
      };
      const gTabs: Tab[] = [];
      while (i < tabs.length && tabs[i].group === gId) {
        gTabs.push(tabs[i]);
        i++;
      }
      stripItems.push({ type: "group", groupId: gId, group: groupInfo, tabs: gTabs });
    } else {
      stripItems.push({ type: "tab", tab });
      i++;
    }
  }

  // Clear hover timer
  const clearTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  // Perform hit testing against tabs and tab groups in DOM
  const performHitTest = (clientX: number, clientY: number, currentDraggedId: string) => {
    if (!containerRef.current) return;

    // Find tab elements
    const tabElements = containerRef.current.querySelectorAll<HTMLElement>("[data-tab-id]");
    let foundTabId: string | null = null;
    let foundGroupId: string | null = null;

    for (const el of Array.from(tabElements)) {
      const tId = el.getAttribute("data-tab-id");
      if (tId && tId !== currentDraggedId) {
        const rect = el.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top - 10 &&
          clientY <= rect.bottom + 10
        ) {
          foundTabId = tId;
          break;
        }
      }
    }

    if (!foundTabId) {
      const groupElements = containerRef.current.querySelectorAll<HTMLElement>("[data-group-id]");
      for (const el of Array.from(groupElements)) {
        const gId = el.getAttribute("data-group-id");
        if (gId) {
          const rect = el.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top - 10 &&
            clientY <= rect.bottom + 10
          ) {
            foundGroupId = gId;
            break;
          }
        }
      }
    }

    if (foundTabId) {
      setTargetGroupId(null);
      if (targetTabId !== foundTabId) {
        setTargetTabId(foundTabId);
        clearTimer();
        hoverTimerRef.current = window.setTimeout(() => {
          setIsGroupingPreview(true);
        }, 120);
      }
    } else if (foundGroupId) {
      setTargetTabId(null);
      setTargetGroupId(foundGroupId);
      setIsGroupingPreview(true);
      clearTimer();
    } else {
      setTargetTabId(null);
      setTargetGroupId(null);
      setIsGroupingPreview(false);
      clearTimer();
    }
  };

  // Pointer event listeners on window during active drag
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (pointerIdRef.current === null) return;

      const deltaX = Math.abs(e.clientX - dragStartPosRef.current.x);
      const deltaY = Math.abs(e.clientY - dragStartPosRef.current.y);

      if (!isDragging) {
        // Check threshold (6px)
        if (deltaX > 6 || deltaY > 6) {
          if (pendingTabIdRef.current) {
            setIsDragging(true);
            setDraggedTabId(pendingTabIdRef.current);
            setDragPos({ x: e.clientX, y: e.clientY });
          }
        }
      } else {
        setDragPos({ x: e.clientX, y: e.clientY });
        if (pendingTabIdRef.current) {
          performHitTest(e.clientX, e.clientY, pendingTabIdRef.current);
        }
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (pointerIdRef.current === null) return;
      clearTimer();

      const sourceTabId = pendingTabIdRef.current;
      const wasDragging = isDragging;
      const currentTargetTabId = targetTabId;
      const currentTargetGroupId = targetGroupId;
      const groupingActive = isGroupingPreview;

      // Clean up pointer capture
      pointerIdRef.current = null;
      pendingTabIdRef.current = null;
      setIsDragging(false);
      setDraggedTabId(null);
      setTargetTabId(null);
      setTargetGroupId(null);
      setIsGroupingPreview(false);

      if (!sourceTabId) return;

      if (!wasDragging) {
        // Normal click -> switch tab
        onSwitch(sourceTabId);
        return;
      }

      // Drag completion logic
      const sourceTab = tabs.find((t) => t.id === sourceTabId);
      if (!sourceTab) return;

      // 1. Dropped onto an existing Group container
      if (currentTargetGroupId) {
        if (sourceTab.group !== currentTargetGroupId) {
          onAddTabToGroup(sourceTabId, currentTargetGroupId);
        }
        return;
      }

      // 2. Dropped onto another Tab
      if (currentTargetTabId && currentTargetTabId !== sourceTabId) {
        const targetTab = tabs.find((t) => t.id === currentTargetTabId);
        if (targetTab) {
          if (targetTab.group) {
            // Target is grouped -> add source to target's group
            if (sourceTab.group !== targetTab.group) {
              onAddTabToGroup(sourceTabId, targetTab.group);
            }
          } else if (groupingActive) {
            // Both are normal tabs or source dragged to target -> create new group!
            if (sourceTab.group) {
              onRemoveTabFromGroup(sourceTabId);
            }
            onGroupTabs([sourceTabId, currentTargetTabId]);
          } else {
            // Reorder tabs
            const srcIdx = tabs.findIndex((t) => t.id === sourceTabId);
            const tgtIdx = tabs.findIndex((t) => t.id === currentTargetTabId);
            if (srcIdx !== -1 && tgtIdx !== -1) {
              const newTabs = [...tabs];
              const [moved] = newTabs.splice(srcIdx, 1);
              newTabs.splice(tgtIdx, 0, moved);
              onReorderTabs(newTabs);
            }
          }
          return;
        }
      }

      // 3. Dragged a grouped tab out into open tab space -> ungroup it
      if (sourceTab.group && !currentTargetTabId && !currentTargetGroupId) {
        // Check if dragged far enough away vertically or to empty tab space
        const deltaY = Math.abs(e.clientY - dragStartPosRef.current.y);
        if (deltaY > 20) {
          onRemoveTabFromGroup(sourceTabId);
        }
      }
    };

    const handleGlobalPointerCancel = () => {
      clearTimer();
      pointerIdRef.current = null;
      pendingTabIdRef.current = null;
      setIsDragging(false);
      setDraggedTabId(null);
      setTargetTabId(null);
      setTargetGroupId(null);
      setIsGroupingPreview(false);
    };

    window.addEventListener("pointermove", handleGlobalPointerMove);
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerCancel);
    };
  }, [isDragging, targetTabId, targetGroupId, isGroupingPreview, tabs, onSwitch, onAddTabToGroup, onGroupTabs, onRemoveTabFromGroup, onReorderTabs]);

  const handlePointerDownTab = (e: React.PointerEvent, tabId: string) => {
    // Only primary mouse button initiates tab interaction
    if (e.button !== 0) return;
    e.stopPropagation();

    pointerIdRef.current = e.pointerId;
    pendingTabIdRef.current = tabId;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (containerRef.current && e.deltaY !== 0) {
      containerRef.current.scrollLeft += e.deltaY * 0.8;
    }
  };

  const draggedTab = tabs.find((t) => t.id === draggedTabId);

  return (
    <div className="tabs-row" onWheel={handleWheel} ref={containerRef}>
      <div className="tabs-container" role="tablist" aria-label="Browser tabs">
        {stripItems.map((item) => {
          if (item.type === "group") {
            const hasActive = item.tabs.some((t) => t.id === activeTabId);
            const isGroupTarget = targetGroupId === item.groupId || (targetTabId && item.tabs.some((t) => t.id === targetTabId));

            return (
              <div
                key={`group-${item.groupId}`}
                data-group-id={item.groupId}
                className={`tab-group no-drag ${hasActive ? "has-active" : ""} ${isGroupTarget ? "group-drag-hover" : ""}`}
                style={{
                  borderColor: hasActive
                    ? item.group.color || "var(--border-strong)"
                    : "var(--border-subtle)",
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenContextMenu({
                    type: "group",
                    x: e.clientX,
                    y: e.clientY,
                    group: item.group,
                    tabs: item.tabs,
                  });
                }}
                title={`${item.group.name} (${item.tabs.length} tabs) • Right-click for options`}
              >
                {/* Group colored bar / indicator */}
                <div
                  className="group-accent-indicator"
                  style={{ backgroundColor: item.group.color || "var(--accent-a)" }}
                />

                <div className="tab-group-icons">
                  {item.tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    const isTabDragged = draggedTabId === tab.id;

                    return (
                      <button
                        key={tab.id}
                        data-tab-id={tab.id}
                        onPointerDown={(e) => handlePointerDownTab(e, tab.id)}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose(tab.id);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const tabIdx = tabs.findIndex((t) => t.id === tab.id);
                          onOpenContextMenu({
                            type: "tab",
                            x: e.clientX,
                            y: e.clientY,
                            tab,
                            tabIndex: tabIdx,
                            totalTabs: tabs.length,
                          });
                        }}
                        className={`tab-group-icon no-drag ${isActive ? "active" : ""} ${isTabDragged ? "source-dragging" : ""}`}
                        title={tab.title}
                      >
                        <Favicon tab={tab} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }

          // Individual standalone tab
          const tab = item.tab;
          const isActive = tab.id === activeTabId;
          const isTarget = targetTabId === tab.id;
          const isTabDragged = draggedTabId === tab.id;
          const tabIdx = tabs.findIndex((t) => t.id === tab.id);

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`tab-wrapper no-drag ${isActive ? "active-wrapper" : ""} ${isTarget && isGroupingPreview ? "grouping-preview-target" : ""} ${isTabDragged ? "source-dragging" : ""}`}
              onPointerDown={(e) => handlePointerDownTab(e, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1 && tab.id !== HOME_TAB_ID) {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenContextMenu({
                  type: "tab",
                  x: e.clientX,
                  y: e.clientY,
                  tab,
                  tabIndex: tabIdx,
                  totalTabs: tabs.length,
                });
              }}
            >
              {isActive && (
                <svg className="tab-curve-left" viewBox="0 0 14 14" aria-hidden="true">
                  <path className="tab-curve-fill" d="M14 0C14 7.7 7.7 14 0 14H14V0Z" />
                  <path className="tab-curve-stroke" d="M14 0C14 7.7 7.7 14 0 14" />
                </svg>
              )}
              <div
                className={`tab ${isActive ? "active" : ""} ${isTarget && isGroupingPreview ? "target-pulse" : ""}`}
                role="tab"
                aria-selected={isActive}
                title={tab.title}
              >
                <span className="tab-icon">
                  <Favicon tab={tab} />
                </span>
                <span className="tab-title">{tab.title}</span>

                {isTarget && isGroupingPreview && (
                  <span className="group-preview-badge" title="Release to group tabs">
                    <Layers size={10} strokeWidth={2.4} />
                    <span>Group</span>
                  </span>
                )}

                {tab.id !== HOME_TAB_ID && !(isTarget && isGroupingPreview) && (
                  <span
                    className="tab-close no-drag"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                    title="Close tab"
                  >
                    <X size={11} />
                  </span>
                )}
              </div>
              {isActive && (
                <svg className="tab-curve-right" viewBox="0 0 14 14" aria-hidden="true">
                  <path className="tab-curve-fill" d="M0 0C0 7.7 6.3 14 14 14H0V0Z" />
                  <path className="tab-curve-stroke" d="M0 0C0 7.7 6.3 14 14 14" />
                </svg>
              )}
            </div>
          );
        })}

        <button className="tab-plus-btn no-drag" onClick={onNewTab} title="New tab (Ctrl+T)">
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Floating Drag Ghost / Preview following cursor */}
      {isDragging && draggedTab && (
        <div
          className="tab-drag-ghost"
          style={{
            transform: `translate3d(${dragPos.x - 30}px, ${dragPos.y - 18}px, 0)`,
          }}
        >
          <div className="tab-ghost-pill">
            <span className="tab-icon">
              <Favicon tab={draggedTab} />
            </span>
            <span className="tab-title">{draggedTab.title}</span>
          </div>
        </div>
      )}
    </div>
  );
}
