import { useEffect, useRef } from "react";
import {
  Check,
  Copy,
  Edit3,
  Layers,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
  X,
  XCircle,
} from "lucide-react";
import type { Tab, TabGroup } from "../types";
import { GROUP_COLORS } from "../utils/browser";

export type ContextMenuData =
  | {
      type: "tab";
      x: number;
      y: number;
      tab: Tab;
      tabIndex: number;
      totalTabs: number;
    }
  | {
      type: "group";
      x: number;
      y: number;
      group: TabGroup;
      tabs: Tab[];
    }
  | {
      type: "page";
      x: number;
      y: number;
      url?: string;
    }
  | {
      type: "split-divider";
      x: number;
      y: number;
    };

interface ContextMenuProps {
  data: ContextMenuData;
  tabGroups: Record<string, TabGroup>;
  onClose: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsToRight: (tabIndex: number) => void;
  onDuplicateTab: (tab: Tab) => void;
  onReloadTab: (tab: Tab) => void;
  onCreateGroupWithTab: (tabId: string) => void;
  onAddTabToGroup: (tabId: string, groupId: string) => void;
  onRemoveTabFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, newName: string) => void;
  onChangeGroupColor: (groupId: string, newColor: string) => void;
  onUngroupGroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onNewTab: () => void;
}

export function ContextMenu({
  data,
  tabGroups,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onDuplicateTab,
  onReloadTab,
  onCreateGroupWithTab,
  onAddTabToGroup,
  onRemoveTabFromGroup,
  onRenameGroup,
  onChangeGroupColor,
  onUngroupGroup,
  onCloseGroup,
  onNewTab,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust menu position so it never overflows window boundaries
  const menuWidth = 210;
  const menuHeight = data.type === "group" ? 280 : data.type === "tab" ? 290 : 160;

  const posX = Math.max(10, Math.min(window.innerWidth - menuWidth - 10, data.x));
  const posY = Math.max(10, Math.min(window.innerHeight - menuHeight - 10, data.y));

  if (data.type === "tab") {
    const { tab, tabIndex, totalTabs } = data;
    const canCloseRight = tabIndex < totalTabs - 1;
    const isGrouped = !!tab.group;
    const availableGroups = Object.values(tabGroups).filter((g) => g.id !== tab.group);

    return (
      <div
        ref={menuRef}
        className="browser-context-menu no-drag"
        style={{ top: `${posY}px`, left: `${posX}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-menu-header">
          <span className="context-menu-title">{tab.title || "Tab Options"}</span>
        </div>
        <div className="context-menu-divider" />

        <button
          className="context-menu-item"
          onClick={() => {
            onReloadTab(tab);
            onClose();
          }}
        >
          <RefreshCw size={13} />
          <span>Reload Tab</span>
        </button>

        <button
          className="context-menu-item"
          onClick={() => {
            onDuplicateTab(tab);
            onClose();
          }}
        >
          <Copy size={13} />
          <span>Duplicate Tab</span>
        </button>

        <div className="context-menu-divider" />

        {isGrouped ? (
          <button
            className="context-menu-item"
            onClick={() => {
              onRemoveTabFromGroup(tab.id);
              onClose();
            }}
          >
            <Unlink size={13} />
            <span>Remove from Group</span>
          </button>
        ) : (
          <button
            className="context-menu-item"
            onClick={() => {
              onCreateGroupWithTab(tab.id);
              onClose();
            }}
          >
            <Layers size={13} />
            <span>Add to New Group</span>
          </button>
        )}

        {availableGroups.length > 0 && !isGrouped && (
          <div className="context-menu-submenu-container">
            <div className="context-menu-label">Move to Group:</div>
            {availableGroups.map((g) => (
              <button
                key={g.id}
                className="context-menu-item sub-item"
                onClick={() => {
                  onAddTabToGroup(tab.id, g.id);
                  onClose();
                }}
              >
                <div className="color-swatch-mini" style={{ backgroundColor: g.color || "var(--accent-a)" }} />
                <span>{g.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="context-menu-divider" />

        <button
          className="context-menu-item danger"
          onClick={() => {
            onCloseTab(tab.id);
            onClose();
          }}
        >
          <X size={13} />
          <span>Close Tab</span>
        </button>

        <button
          className="context-menu-item"
          onClick={() => {
            onCloseOtherTabs(tab.id);
            onClose();
          }}
        >
          <XCircle size={13} />
          <span>Close Other Tabs</span>
        </button>

        {canCloseRight && (
          <button
            className="context-menu-item"
            onClick={() => {
              onCloseTabsToRight(tabIndex);
              onClose();
            }}
          >
            <span>Close Tabs to the Right</span>
          </button>
        )}
      </div>
    );
  }

  if (data.type === "group") {
    const { group, tabs } = data;
    return (
      <div
        ref={menuRef}
        className="browser-context-menu no-drag"
        style={{ top: `${posY}px`, left: `${posX}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-menu-header">
          <div className="color-swatch-mini" style={{ backgroundColor: group.color || "var(--accent-a)" }} />
          <span className="context-menu-title">{group.name}</span>
          <span className="context-menu-count">({tabs.length} tabs)</span>
        </div>

        <div className="context-menu-divider" />

        <button
          className="context-menu-item"
          onClick={() => {
            const newName = window.prompt("Enter new group name:", group.name);
            if (newName && newName.trim()) {
              onRenameGroup(group.id, newName.trim());
            }
            onClose();
          }}
        >
          <Edit3 size={13} />
          <span>Rename Group</span>
        </button>

        <div className="context-menu-color-palette">
          <div className="context-menu-color-label">
            <Palette size={11} />
            <span>Group Color</span>
          </div>
          <div className="color-swatch-row">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.value}
                className={`color-swatch-btn ${(group.color || "#6e9bff") === c.value ? "selected" : ""}`}
                style={{ backgroundColor: c.value }}
                onClick={() => {
                  onChangeGroupColor(group.id, c.value);
                  onClose();
                }}
                title={c.name}
              >
                {(group.color || "#6e9bff") === c.value && <Check size={9} color="#000" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="context-menu-divider" />

        <button
          className="context-menu-item"
          onClick={() => {
            onUngroupGroup(group.id);
            onClose();
          }}
        >
          <Unlink size={13} />
          <span>Ungroup Tabs</span>
        </button>

        <button
          className="context-menu-item danger"
          onClick={() => {
            onCloseGroup(group.id);
            onClose();
          }}
        >
          <Trash2 size={13} />
          <span>Close Group</span>
        </button>
      </div>
    );
  }

  // Page / Viewport Background Context Menu
  return (
    <div
      ref={menuRef}
      className="browser-context-menu no-drag"
      style={{ top: `${posY}px`, left: `${posX}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        className="context-menu-item"
        onClick={() => {
          onNewTab();
          onClose();
        }}
      >
        <Plus size={13} />
        <span>New Tab</span>
      </button>

      {data.type === "page" && data.url && (
        <button
          className="context-menu-item"
          onClick={() => {
            if (data.type === "page" && data.url) navigator.clipboard.writeText(data.url);
            onClose();
          }}
        >
          <Copy size={13} />
          <span>Copy Page URL</span>
        </button>
      )}
    </div>
  );
}
