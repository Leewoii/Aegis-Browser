import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Search,
  Shield,
  Loader2,
  Palette,
  Globe,
  KeyRound,
  Power,
  Lock,
  Copy,
  Check,
  AlertTriangle,
  FileDown,
  Clock,
} from "lucide-react";
import type { SearchEngine, Settings, ThemeName } from "../types";
import { retrieveSecureSecret, storeSecureSecret } from "../services/storage";

type SectionId = "general" | "appearance" | "privacy" | "passwords";

interface SettingsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  activeWorkspaceId: string;
  onClearHistory: () => void;
  onClearDownloads: () => void;
  onClearProfileData: (profileKey: string) => Promise<void>;
}

interface CredentialItem {
  id: string;
  site: string;
  username: string;
  password_decrypted: string;
}

const THEMES: Array<{ value: ThemeName; label: string; desc: string }> = [
  { value: "dark", label: "Dark", desc: "Default · #06070c" },
  { value: "amoled", label: "Amoled", desc: "Pure black · OLED" },
  { value: "nord", label: "Nord", desc: "Cool gray · #2e3440" },
  { value: "light", label: "Light", desc: "Bright · #f8fafc" },
  { value: "dracula", label: "Dracula", desc: "Violet · #282a36" },
  { value: "catppuccin", label: "Catppuccin", desc: "Mocha · #1e1e2e" },
  { value: "solarized", label: "Solarized", desc: "Teal · #002b36" },
  { value: "tokyo", label: "Tokyo Night", desc: "Blue · #1a1b26" },
  { value: "gruvbox", label: "Gruvbox", desc: "Warm · #282828" },
  { value: "rose-pine", label: "Rose Pine", desc: "Rose · #191724" },
];

const ENGINES: Array<{ value: SearchEngine; label: string }> = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "google", label: "Google" },
  { value: "bing", label: "Bing" },
];

function Switch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`settings-switch ${checked ? "on" : "off"}`}
      type="button"
    >
      <span className="settings-switch-thumb" />
    </button>
  );
}

export function SettingsScreen({
  settings,
  onChange,
  activeWorkspaceId,
  onClearHistory,
  onClearDownloads,
  onClearProfileData,
}: SettingsScreenProps) {
  const [section, setSection] = useState<SectionId>("general");
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newSite, setNewSite] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [clearingProfile, setClearingProfile] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await retrieveSecureSecret("saved_credentials");
        if (active && raw) {
          try {
            setCredentials(JSON.parse(raw));
          } catch {
            setCredentials([]);
          }
        }
      } catch (err) {
        console.error("Failed to load credentials:", err);
      } finally {
        if (active) setLoadingCreds(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const saveCredsList = async (list: CredentialItem[]) => {
    setCredentials(list);
    try {
      await storeSecureSecret("saved_credentials", JSON.stringify(list));
    } catch (err) {
      console.error("Failed to save credentials:", err);
    }
  };

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSite.trim() || !newUsername.trim() || !newPassword.trim()) return;
    const newItem: CredentialItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      site: newSite.trim(),
      username: newUsername.trim(),
      password_decrypted: newPassword.trim(),
    };
    await saveCredsList([...credentials, newItem]);
    setNewSite("");
    setNewUsername("");
    setNewPassword("");
    setShowNew(false);
  };

  const handleDeleteCredential = async (id: string) => {
    if (!window.confirm("Delete this login?")) return;
    await saveCredsList(credentials.filter((c) => c.id !== id));
  };

  const togglePasswordVisibility = (id: string) =>
    setVisiblePasswords((prev) => ({ ...prev, [id]: !prev[id] }));

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1400);
  };

  const handleClearWorkspaceProfile = async () => {
    if (!window.confirm(`Reset profile for workspace "${activeWorkspaceId}"? Cookies, storage and cache will be cleared.`)) return;
    setClearingProfile(true);
    try {
      await onClearProfileData(`workspace_${activeWorkspaceId}`);
    } finally {
      setClearingProfile(false);
    }
  };

  const filteredCreds = useMemo(
    () =>
      credentials.filter(
        (c) =>
          !search.trim() ||
          c.site.toLowerCase().includes(search.toLowerCase()) ||
          c.username.toLowerCase().includes(search.toLowerCase())
      ),
    [credentials, search]
  );

  return (
    <section className="settings-screen settings-screen--redesign">
      <div className="settings-layout">
        {/* Sidebar nav */}
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-head">
            <h1>Settings</h1>
            <p>{activeWorkspaceId}</p>
          </div>

          <button className={`settings-nav-item ${section === "general" ? "active" : ""}`} onClick={() => setSection("general")}>
            <Globe size={15} />
            General
          </button>
          <button className={`settings-nav-item ${section === "appearance" ? "active" : ""}`} onClick={() => setSection("appearance")}>
            <Palette size={15} />
            Appearance
          </button>
          <button className={`settings-nav-item ${section === "privacy" ? "active" : ""}`} onClick={() => setSection("privacy")}>
            <Shield size={15} />
            Privacy
          </button>
          <button className={`settings-nav-item ${section === "passwords" ? "active" : ""}`} onClick={() => setSection("passwords")}>
            <KeyRound size={15} />
            Passwords
            <span className="settings-nav-count">{loadingCreds ? "…" : credentials.length}</span>
          </button>

          <div className="settings-nav-foot">
            <span>Aegis</span>
            <span className="settings-workspace-dot" />
            <span>{settings.searchEngine}</span>
          </div>
        </nav>

        {/* Content */}
        <div className="settings-content">
          {section === "general" && (
            <div className="settings-section">
              <header className="settings-section-head">
                <h2>General</h2>
                <p>Search, startup and browsing defaults.</p>
              </header>

              <div className="settings-group">
                <div className="settings-field">
                  <div className="settings-field-text">
                    <label>Search engine</label>
                    <p>Used for address bar and new tab search</p>
                  </div>
                  <select value={settings.searchEngine} onChange={(e) => onChange({ searchEngine: e.target.value as SearchEngine })}>
                    {ENGINES.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field">
                  <div className="settings-field-text">
                    <label htmlFor="greeting">Home greeting</label>
                    <p>Shown on the new tab screen</p>
                  </div>
                  <input
                    id="greeting"
                    className="settings-input"
                    value={settings.homeGreeting}
                    placeholder="Frost"
                    onChange={(e) => onChange({ homeGreeting: e.target.value })}
                  />
                </div>

                <div className="settings-field">
                  <div className="settings-field-text">
                    <label>On startup</label>
                    <p>What to show when the browser opens</p>
                  </div>
                  <select
                    value={settings.startupBehavior || "previous"}
                    onChange={(e) => onChange({ startupBehavior: e.target.value as Settings["startupBehavior"] })}
                  >
                    <option value="previous">Restore previous session</option>
                    <option value="home">Show new tab</option>
                  </select>
                </div>

                <div className="settings-field">
                  <div className="settings-field-text">
                    <label htmlFor="dl">Downloads folder</label>
                    <p>Path shown in download prompts</p>
                  </div>
                  <input
                    id="dl"
                    className="settings-input"
                    value={settings.defaultDownloadsPath || "Downloads"}
                    onChange={(e) => onChange({ defaultDownloadsPath: e.target.value })}
                  />
                </div>

                <div className="settings-field">
                  <div className="settings-field-text">
                    <label htmlFor="ad-block-toggle">Block ads & trackers</label>
                    <p>Built-in shield for supported pages</p>
                  </div>
                  <Switch id="ad-block-toggle" checked={!!settings.adBlockingEnabled} onChange={(v) => onChange({ adBlockingEnabled: v })} />
                </div>
              </div>
            </div>
          )}

          {section === "appearance" && (
            <div className="settings-section">
              <header className="settings-section-head">
                <h2>Appearance</h2>
                <p>Theme is applied immediately.</p>
              </header>

              <div className="settings-theme-grid">
                {THEMES.map((t) => {
                  const active = settings.theme === t.value;
                  return (
                    <button
                      key={t.value}
                      className={`settings-theme-card ${active ? "active" : ""}`}
                      onClick={() => onChange({ theme: t.value })}
                      aria-pressed={active}
                    >
                      <span className={`settings-theme-swatch theme-${t.value}`} aria-hidden />
                      <span className="settings-theme-label">
                        <strong>{t.label}</strong>
                        <span>{t.desc}</span>
                      </span>
                      <span className={`settings-theme-check ${active ? "on" : ""}`}>{active && <Check size={12} />}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {section === "privacy" && (
            <div className="settings-section">
              <header className="settings-section-head">
                <h2>Privacy & data</h2>
                <p>Clearing affects the active workspace only — <code className="settings-inline-code">{activeWorkspaceId}</code></p>
              </header>

              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-icon danger">
                    <Power size={14} />
                  </div>
                  <div className="settings-row-text">
                    <strong>Reset workspace profile</strong>
                    <span>Cookies, local storage and cache for this workspace</span>
                  </div>
                  <button className="settings-btn danger" onClick={handleClearWorkspaceProfile} disabled={clearingProfile}>
                    {clearingProfile ? <Loader2 size={13} className="spin" /> : <AlertTriangle size={13} />}
                    {clearingProfile ? "Resetting…" : "Reset"}
                  </button>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon">
                    <Clock size={14} />
                  </div>
                  <div className="settings-row-text">
                    <strong>Clear browsing history</strong>
                    <span>Removes history entries from all workspaces</span>
                  </div>
                  <button
                    className="settings-btn"
                    onClick={() => {
                      if (window.confirm("Clear browsing history?")) onClearHistory();
                    }}
                  >
                    <Trash2 size={13} />
                    Clear
                  </button>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon">
                    <FileDown size={14} />
                  </div>
                  <div className="settings-row-text">
                    <strong>Clear downloads</strong>
                    <span>Removes the list only — files stay on disk</span>
                  </div>
                  <button
                    className="settings-btn"
                    onClick={() => {
                      if (window.confirm("Clear download history?")) onClearDownloads();
                    }}
                  >
                    <Trash2 size={13} />
                    Clear
                  </button>
                </div>
              </div>

              <div className="settings-hint">
                <Lock size={12} />
                Workspace data is stored per-profile under <code>profiles/workspace_{activeWorkspaceId}</code> and isolated by the engine.
              </div>
            </div>
          )}

          {section === "passwords" && (
            <div className="settings-section">
              <header className="settings-section-head with-actions">
                <div>
                  <h2>Passwords</h2>
                  <p>Encrypted with DPAPI on this device. Never leaves your profile.</p>
                </div>
                <button className="settings-btn primary" onClick={() => setShowNew((v) => !v)}>
                  <Plus size={13} />
                  New login
                </button>
              </header>

              {showNew && (
                <form onSubmit={handleAddCredential} className="settings-new-form">
                  <input
                    className="settings-input"
                    value={newSite}
                    onChange={(e) => setNewSite(e.target.value)}
                    placeholder="site — example.com"
                    required
                  />
                  <input
                    className="settings-input"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="username or email"
                    required
                  />
                  <input
                    className="settings-input"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="password"
                    required
                  />
                  <div className="settings-new-actions">
                    <button type="button" className="settings-btn" onClick={() => setShowNew(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="settings-btn primary">
                      Save
                    </button>
                  </div>
                </form>
              )}

              <div className="settings-toolbar">
                <div className="settings-search-wrap">
                  <Search size={14} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by site or username" />
                  {search && (
                    <button onClick={() => setSearch("")} aria-label="Clear">
                      ×
                    </button>
                  )}
                </div>
                <span className="settings-count">{loadingCreds ? "Loading…" : `${filteredCreds.length} of ${credentials.length}`}</span>
              </div>

              {loadingCreds ? (
                <div className="settings-empty">
                  <Loader2 size={18} className="spin" />
                  Loading vault…
                </div>
              ) : filteredCreds.length === 0 ? (
                <div className="settings-empty">
                  <KeyRound size={20} />
                  <strong>{search ? "No matches" : "No passwords yet"}</strong>
                  <span>{search ? "Try a different term." : "Save your first login — it stays on this device."}</span>
                </div>
              ) : (
                <div className="settings-vault-list">
                  {filteredCreds.map((c) => {
                    const show = !!visiblePasswords[c.id];
                    return (
                      <div key={c.id} className="settings-vault-row">
                        <div className="settings-vault-main">
                          <div className="settings-vault-site">
                            <span className="settings-vault-favicon">{c.site.slice(0, 1).toUpperCase()}</span>
                            <strong>{c.site}</strong>
                          </div>
                          <div className="settings-vault-meta">
                            <span>{c.username}</span>
                            <span className="settings-dot">·</span>
                            <span className="settings-pass">{show ? c.password_decrypted : "••••••••"}</span>
                            <button className="settings-icon" onClick={() => copy(c.password_decrypted, `p-${c.id}`)} title="Copy password">
                              {copiedField === `p-${c.id}` ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                            <button className="settings-icon" onClick={() => copy(c.username, `u-${c.id}`)} title="Copy username">
                              {copiedField === `u-${c.id}` ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                        </div>
                        <div className="settings-vault-actions">
                          <button className="settings-icon" onClick={() => togglePasswordVisibility(c.id)} aria-label={show ? "Hide" : "Show"}>
                            {show ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button className="settings-icon danger" onClick={() => handleDeleteCredential(c.id)} aria-label="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
