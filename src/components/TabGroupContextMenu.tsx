import { useEffect, useRef, useState } from "react";
import { Check, Edit3, Palette, Trash2, Unlink } from "lucide-react";
import type { TabGroup } from "../types";
import { GROUP_COLORS } from "../utils/browser";

interface TabGroupContextMenuProps {
  group: TabGroup;
  tabCount: number;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: (groupId: string, newName: string) => void;
  onChangeColor: (groupId: string, newColor: string) => void;
  onUngroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
}

export function TabGroupContextMenu({
  group,
  tabCount,
  position,
  onClose,
  onRename,
  onChangeColor,
  onUngroup,
  onCloseGroup,
}: TabGroupContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.name);

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

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      onRename(group.id, nameInput.trim());
    }
    setIsEditingName(false);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="tab-group-context-menu no-drag"
      style={{
        top: `${Math.min(window.innerHeight - 280, Math.max(10, position.y))}px`,
        left: `${Math.min(window.innerWidth - 220, Math.max(10, position.x))}px`,
      }}
    >
      <div className="menu-header">
        <div className="group-badge-dot" style={{ backgroundColor: group.color || "var(--accent-a)" }} />
        <span className="menu-group-title">{group.name}</span>
        <span className="menu-group-count">{tabCount} {tabCount === 1 ? "tab" : "tabs"}</span>
      </div>

      <div className="menu-divider" />

      {isEditingName ? (
        <form onSubmit={handleNameSubmit} className="menu-name-form">
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => setIsEditingName(false)}
            className="menu-name-input"
            placeholder="Group name"
          />
        </form>
      ) : (
        <button
          className="menu-item"
          onClick={() => setIsEditingName(true)}
        >
          <Edit3 size={13} />
          <span>Rename group</span>
        </button>
      )}

      <div className="menu-color-section">
        <div className="menu-color-label">
          <Palette size={12} />
          <span>Accent color</span>
        </div>
        <div className="menu-color-palette">
          {GROUP_COLORS.map((c) => (
            <button
              key={c.value}
              className={`color-swatch ${(group.color || "#6e9bff") === c.value ? "selected" : ""}`}
              style={{ backgroundColor: c.value }}
              onClick={() => {
                onChangeColor(group.id, c.value);
                onClose();
              }}
              title={c.name}
            >
              {(group.color || "#6e9bff") === c.value && <Check size={10} color="#000" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div className="menu-divider" />

      <button
        className="menu-item"
        onClick={() => {
          onUngroup(group.id);
          onClose();
        }}
      >
        <Unlink size={13} />
        <span>Ungroup tabs</span>
      </button>

      <button
        className="menu-item danger"
        onClick={() => {
          onCloseGroup(group.id);
          onClose();
        }}
      >
        <Trash2 size={13} />
        <span>Close group</span>
      </button>
    </div>
  );
}
