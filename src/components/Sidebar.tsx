import { forwardRef, useState, useEffect } from "react";
import { devConsole } from "../services/devConsole";
import {
  Bookmark,
  Briefcase,
  Clock3,
  Compass,
  Cpu,
  Download,
  Flame,
  FolderLock,
  Gamepad2,
  Globe,
  Home,
  Layers,
  MessageSquare,
  Palette,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Twitch,
  RefreshCw,
  User,
} from "lucide-react";
import type { PanelId, Workspace } from "../types";
import { ChatGptIcon, MessengerIcon, SpotifyIcon, WhatsAppIcon } from "./Icons";

interface SidebarProps {
  isPinned: boolean;
  onTogglePin: () => void;
  activePanel: PanelId | null;
  onTogglePanel: (panel: PanelId) => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (wsId: string) => void;
  onAddWorkspace: () => void;
  onDeleteWorkspace: (wsId: string) => void;
  workspaceTabCounts: Record<string, number>;
  onHomeClick: () => void;
  onConsoleClick: () => void;
  isConsoleOpen: boolean;
  onUpdatesClick: () => void;
  isUpdatesOpen: boolean;
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  onTransitionEnd?: () => void;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  {
    isPinned,
    onTogglePin,
    activePanel,
    onTogglePanel,
    workspaces,
    activeWorkspaceId,
    onSelectWorkspace,
    onAddWorkspace,
    onDeleteWorkspace,
    workspaceTabCounts,
    onHomeClick,
    onConsoleClick,
    isConsoleOpen,
    onUpdatesClick,
    isUpdatesOpen,
    onSettingsClick,
    isSettingsOpen,
    isHovered: isHoveredProp,
    onHoverChange,
    onTransitionEnd,
  },
  ref,
) {
  const [internalIsHovered, setInternalIsHovered] = useState(false);
  const [errorCount, setErrorCount] = useState(() => devConsole.getStats().errors);

  useEffect(() => {
    return devConsole.subscribeStats((stats) => {
      setErrorCount(stats.errors);
    });
  }, []);

  const isHovered = isHoveredProp !== undefined ? isHoveredProp : internalIsHovered;

  const expanded = isPinned || isHovered;

  const getWorkspaceIcon = (iconName?: string) => {
    switch (iconName) {
      case "code":
        return <Terminal size={18} strokeWidth={1.8} />;
      case "shield":
        return <Shield size={18} strokeWidth={1.8} />;
      case "sparkles":
        return <Sparkles size={18} strokeWidth={1.8} />;
      case "briefcase":
        return <Briefcase size={18} strokeWidth={1.8} />;
      case "globe":
        return <Globe size={18} strokeWidth={1.8} />;
      case "compass":
        return <Compass size={18} strokeWidth={1.8} />;
      case "folder":
        return <FolderLock size={18} strokeWidth={1.8} />;
      case "gamepad":
        return <Gamepad2 size={18} strokeWidth={1.8} />;
      case "cpu":
        return <Cpu size={18} strokeWidth={1.8} />;
      case "flame":
        return <Flame size={18} strokeWidth={1.8} />;
      case "palette":
        return <Palette size={18} strokeWidth={1.8} />;
      case "user":
      default:
        return <User size={18} strokeWidth={1.8} />;
    }
  };

  return (
    <aside
      ref={ref}
      className={`sidebar-shell no-drag ${expanded ? "expanded" : "collapsed"} ${isPinned ? "pinned" : ""}`}
      onMouseEnter={() => {
        setInternalIsHovered(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setInternalIsHovered(false);
        onHoverChange?.(false);
      }}
      onPointerEnter={() => {
        setInternalIsHovered(true);
        onHoverChange?.(true);
      }}
      onPointerLeave={() => {
        setInternalIsHovered(false);
        onHoverChange?.(false);
      }}
      onTransitionEnd={onTransitionEnd}
    >
      <div className="sidebar-inner">
        {/* Home rail item */}
        <div className="sidebar-section">
          <button
            className="sidebar-item"
            onClick={onHomeClick}
            title="Home Screen"
          >
            <span className="sidebar-icon">
              <Home size={18} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Home</span>}
          </button>
        </div>

        <div className="sidebar-divider" />

        {/* Workspaces */}
        <div className="sidebar-section workspaces-section">
          <div className="sidebar-section-title">
            <div className="section-title-left">
              <Layers size={13} strokeWidth={1.8} />
              {expanded && <span>Workspaces</span>}
            </div>
            {expanded && (
              <button
                className="section-add-btn no-drag"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddWorkspace();
                }}
                title="Create new workspace"
              >
                <Plus size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>

          <div className="workspace-list">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              const count = workspaceTabCounts[ws.id] || 0;
              return (
                <button
                  key={ws.id}
                  className={`workspace-btn ${isActive ? "active" : ""}`}
                  onClick={() => onSelectWorkspace(ws.id)}
                  title={`${ws.name} (${count} tabs)`}
                >
                  <span className="workspace-icon" style={{ color: ws.color || "inherit" }}>
                    {getWorkspaceIcon(ws.icon)}
                  </span>
                  {expanded && (
                    <>
                      <span className="workspace-name">{ws.name}</span>
                      {count > 0 && <span className="workspace-badge">{count}</span>}
                      {workspaces.length > 1 && (
                        <span
                          className="workspace-delete-btn"
                          title={`Delete ${ws.name} workspace`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteWorkspace(ws.id);
                          }}
                        >
                          <Trash2 size={12} strokeWidth={1.8} />
                        </span>
                      )}
                    </>
                  )}
                  {isActive && <div className="workspace-active-bar" style={{ backgroundColor: ws.color }} />}
                </button>
              );
            })}

            {/* Quick add workspace button */}
            <button
              className="workspace-btn add-workspace-btn"
              onClick={onAddWorkspace}
              title="Add new workspace"
            >
              <span className="workspace-icon">
                <Plus size={14} strokeWidth={2} />
              </span>
              {expanded && <span className="workspace-name">New Workspace</span>}
            </button>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Middle rail section: Tools */}
        <div className="sidebar-section tools-section">
          <div className="sidebar-section-title">
            <Sparkles size={13} strokeWidth={1.8} />
            {expanded && <span>Tools & AI</span>}
          </div>

          <button
            className={`sidebar-item ${activePanel === "chatgpt" ? "active" : ""}`}
            onClick={() => onTogglePanel("chatgpt")}
            title="ChatGPT Assistant"
          >
            <span className="sidebar-icon">
              <ChatGptIcon size={18} />
            </span>
            {expanded && <span className="sidebar-label">ChatGPT</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "notes" ? "active" : ""}`}
            onClick={() => onTogglePanel("notes")}
            title="Scratchpad Notes"
          >
            <span className="sidebar-icon">
              <PenLine size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Scratchpad</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "bookmarks" ? "active" : ""}`}
            onClick={() => onTogglePanel("bookmarks")}
            title="Bookmarks"
          >
            <span className="sidebar-icon">
              <Bookmark size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Bookmarks</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "history" ? "active" : ""}`}
            onClick={() => onTogglePanel("history")}
            title="History"
          >
            <span className="sidebar-icon">
              <Clock3 size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">History</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "downloads" ? "active" : ""}`}
            onClick={() => onTogglePanel("downloads")}
            title="Downloads"
          >
            <span className="sidebar-icon">
              <Download size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Downloads</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "terminal" ? "active" : ""}`}
            onClick={() => onTogglePanel("terminal")}
            title="Terminal — PowerShell / Command Prompt"
          >
            <span className="sidebar-icon">
              <Terminal size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Terminal</span>}
          </button>
        </div>

        <div className="sidebar-divider" />

        {/* Quick Web Apps */}
        <div className="sidebar-section apps-section">
          <div className="sidebar-section-title">
            <MessageSquare size={13} strokeWidth={1.8} />
            {expanded && <span>Apps</span>}
          </div>

          <button
            className={`sidebar-item ${activePanel === "spotify" ? "active" : ""}`}
            onClick={() => onTogglePanel("spotify")}
            title="Spotify"
          >
            <span className="sidebar-icon">
              <SpotifyIcon size={17} />
            </span>
            {expanded && <span className="sidebar-label">Spotify</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "twitch" ? "active" : ""}`}
            onClick={() => onTogglePanel("twitch")}
            title="Twitch"
          >
            <span className="sidebar-icon">
              <Twitch size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Twitch</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "messenger" ? "active" : ""}`}
            onClick={() => onTogglePanel("messenger")}
            title="Messenger"
          >
            <span className="sidebar-icon">
              <MessengerIcon size={17} />
            </span>
            {expanded && <span className="sidebar-label">Messenger</span>}
          </button>

          <button
            className={`sidebar-item ${activePanel === "whatsapp" ? "active" : ""}`}
            onClick={() => onTogglePanel("whatsapp")}
            title="WhatsApp"
          >
            <span className="sidebar-icon">
              <WhatsAppIcon size={17} />
            </span>
            {expanded && <span className="sidebar-label">WhatsApp</span>}
          </button>
        </div>

        <div className="sidebar-spacer" />

        {/* Bottom actions: Dev Console, Updates, Settings & Pin */}
        <div className="sidebar-footer">
          <button
            className={`sidebar-item ${isConsoleOpen ? "active" : ""}`}
            onClick={onConsoleClick}
            title="Developer & Debugging Console"
          >
            <span className="sidebar-icon">
              <Terminal size={17} strokeWidth={1.8} />
              {!expanded && errorCount > 0 && (
                <span
                  className="sidebar-badge error icon-corner"
                  title={`${errorCount} runtime errors detected`}
                >
                  {errorCount > 99 ? "99+" : errorCount}
                </span>
              )}
            </span>
            {expanded && <span className="sidebar-label">Dev Console</span>}
            {expanded && errorCount > 0 && (
              <span
                className="sidebar-badge error"
                title={`${errorCount} runtime errors detected`}
              >
                {errorCount > 99 ? "99+" : errorCount}
              </span>
            )}
          </button>

          <button
            className={`sidebar-item ${isUpdatesOpen ? "active" : ""}`}
            onClick={onUpdatesClick}
            title="Check for updates"
          >
            <span className="sidebar-icon">
              <RefreshCw size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Updates</span>}
          </button>

          <button
            className={`sidebar-item ${isSettingsOpen ? "active" : ""}`}
            onClick={onSettingsClick}
            title="Settings"
          >
            <span className="sidebar-icon">
              <SettingsIcon size={17} strokeWidth={1.8} />
            </span>
            {expanded && <span className="sidebar-label">Settings</span>}
          </button>

          <button
            className={`sidebar-item pin-toggle ${isPinned ? "active" : ""}`}
            onClick={onTogglePin}
            title={isPinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            <span className="sidebar-icon">
              {isPinned ? <PinOff size={14} strokeWidth={1.8} /> : <Pin size={14} strokeWidth={1.8} />}
            </span>
            {expanded && <span className="sidebar-label">{isPinned ? "Unpin" : "Pin sidebar"}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
});
