import { useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Compass,
  Cpu,
  Flame,
  FolderLock,
  Gamepad2,
  Globe,
  Palette,
  Shield,
  Sparkles,
  Terminal,
  User,
  X,
} from "lucide-react";
import type { Workspace } from "../types";
import { uid } from "../utils/browser";

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (workspace: Workspace) => void;
  existingCount: number;
}

export const WORKSPACE_COLORS = [
  { name: "Blue", value: "#6e9bff" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Cyan", value: "#7de3ff" },
  { name: "Emerald", value: "#34d399" },
  { name: "Amber", value: "#fbbf24" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Pink", value: "#ec4899" },
  { name: "Indigo", value: "#818cf8" },
  { name: "Orange", value: "#fb923c" },
];

export const WORKSPACE_ICONS = [
  { id: "code", label: "Dev", icon: Terminal },
  { id: "shield", label: "Security", icon: Shield },
  { id: "sparkles", label: "AI", icon: Sparkles },
  { id: "briefcase", label: "Work", icon: Briefcase },
  { id: "globe", label: "Web", icon: Globe },
  { id: "compass", label: "Explore", icon: Compass },
  { id: "folder", label: "Projects", icon: FolderLock },
  { id: "gamepad", label: "Gaming", icon: Gamepad2 },
  { id: "cpu", label: "Tech", icon: Cpu },
  { id: "flame", label: "Trending", icon: Flame },
  { id: "palette", label: "Design", icon: Palette },
  { id: "user", label: "Personal", icon: User },
];

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreate,
  existingCount,
}: CreateWorkspaceModalProps) {
  const [name, setName] = useState(`Workspace ${existingCount + 1}`);
  const [selectedColor, setSelectedColor] = useState(
    WORKSPACE_COLORS[existingCount % WORKSPACE_COLORS.length].value,
  );
  const [selectedIcon, setSelectedIcon] = useState(
    WORKSPACE_ICONS[existingCount % WORKSPACE_ICONS.length].id,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(`Workspace ${existingCount + 1}`);
      setSelectedColor(WORKSPACE_COLORS[existingCount % WORKSPACE_COLORS.length].value);
      setSelectedIcon(WORKSPACE_ICONS[existingCount % WORKSPACE_ICONS.length].id);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, existingCount]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    onCreate({
      id: uid(),
      name: trimmed,
      color: selectedColor,
      icon: selectedIcon,
    });
    onClose();
  };

  const SelectedIconComp =
    WORKSPACE_ICONS.find((i) => i.id === selectedIcon)?.icon || User;

  return (
    <div className="workspace-modal-overlay" onClick={onClose}>
      <div
        className="workspace-modal-card no-drag"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Ambient Top Glow */}
        <div
          className="workspace-modal-glow"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${selectedColor}26 0%, transparent 70%)`,
          }}
        />

        {/* Modal Header */}
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <span
              className="workspace-modal-icon-badge"
              style={{ color: selectedColor, borderColor: `${selectedColor}40`, backgroundColor: `${selectedColor}15` }}
            >
              <SelectedIconComp size={18} strokeWidth={2} />
            </span>
            <div>
              <h2 className="workspace-modal-title">New Workspace</h2>
              <p className="workspace-modal-subtitle">Organize and isolate your tabs, tools, and groups</p>
            </div>
          </div>
          <button className="workspace-modal-close" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="workspace-modal-body">
          {/* Name Input */}
          <div className="workspace-modal-field">
            <label className="workspace-modal-label" htmlFor="workspace-name-input">
              Workspace Name
            </label>
            <input
              id="workspace-name-input"
              ref={inputRef}
              type="text"
              className="workspace-modal-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research, Client Project, Media..."
              maxLength={40}
              required
            />
          </div>

          {/* Color Picker */}
          <div className="workspace-modal-field">
            <label className="workspace-modal-label">Accent Color</label>
            <div className="workspace-color-grid">
              {WORKSPACE_COLORS.map((c) => {
                const isSelected = selectedColor === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    className={`workspace-color-swatch ${isSelected ? "selected" : ""}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setSelectedColor(c.value)}
                    title={c.name}
                  >
                    {isSelected && <div className="workspace-color-check" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Selector */}
          <div className="workspace-modal-field">
            <label className="workspace-modal-label">Icon</label>
            <div className="workspace-icon-grid">
              {WORKSPACE_ICONS.map((item) => {
                const isSelected = selectedIcon === item.id;
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`workspace-icon-option ${isSelected ? "selected" : ""}`}
                    style={{
                      color: isSelected ? selectedColor : "inherit",
                      borderColor: isSelected ? `${selectedColor}60` : undefined,
                      backgroundColor: isSelected ? `${selectedColor}18` : undefined,
                    }}
                    onClick={() => setSelectedIcon(item.id)}
                    title={item.label}
                  >
                    <IconComponent size={16} strokeWidth={1.9} />
                    <span className="workspace-icon-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Preview */}
          <div className="workspace-modal-field">
            <label className="workspace-modal-label">Sidebar Preview</label>
            <div className="workspace-preview-box">
              <div
                className="workspace-btn active"
                style={{ maxWidth: "220px", pointerEvents: "none" }}
              >
                <span className="workspace-icon" style={{ color: selectedColor }}>
                  <SelectedIconComp size={16} strokeWidth={1.8} />
                </span>
                <span className="workspace-name">{name.trim() || "Untitled Workspace"}</span>
                <span className="workspace-badge">1</span>
                <div className="workspace-active-bar" style={{ backgroundColor: selectedColor }} />
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="workspace-modal-footer">
            <button type="button" className="workspace-modal-btn cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="workspace-modal-btn submit"
              style={{
                backgroundColor: selectedColor,
                color: "#05060b",
                boxShadow: `0 2px 14px ${selectedColor}40`,
              }}
              disabled={!name.trim()}
            >
              Create Workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
