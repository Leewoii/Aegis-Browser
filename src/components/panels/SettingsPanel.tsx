import { useEffect, useState } from "react";
import { Eye, EyeOff, Trash2, Plus, Search, Shield, Loader2, Settings2, History, Download } from "lucide-react";
import type { SearchEngine, Settings, ThemeName } from "../../types";
import { retrieveSecureSecret, storeSecureSecret } from "../../services/storage";

interface SettingsPanelProps {
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

const THEMES: Array<{ value: ThemeName; label: string }> = [
  { value: "dark", label: "Sleek Dark (Default)" },
  { value: "amoled", label: "Amoled Black" },
  { value: "nord", label: "Nordic Frost" },
];

const ENGINES: Array<{ value: SearchEngine; label: string }> = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "google", label: "Google" },
  { value: "bing", label: "Bing" },
];

export function SettingsPanel({
  settings,
  onChange,
  activeWorkspaceId,
  onClearHistory,
  onClearDownloads,
  onClearProfileData,
}: SettingsPanelProps) {
  // DPAPI Credentials Manager state
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [search, setSearch] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // Clearing workspace state loading
  const [clearingProfile, setClearingProfile] = useState(false);

  // Load logins from secure vault on mount
  useEffect(() => {
    let active = true;
    async function loadCredentials() {
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
        console.error("Failed to load credentials from vault:", err);
      } finally {
        if (active) setLoadingCreds(false);
      }
    }
    void loadCredentials();
    return () => {
      active = false;
    };
  }, []);

  const saveCredsList = async (list: CredentialItem[]) => {
    setCredentials(list);
    try {
      await storeSecureSecret("saved_credentials", JSON.stringify(list));
    } catch (err) {
      console.error("Failed to save credentials list secure vault:", err);
    }
  };

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSite.trim() || !newUsername.trim() || !newPassword.trim()) return;

    const newItem: CredentialItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      site: newSite.trim(),
      username: newUsername.trim(),
      password_decrypted: newPassword.trim(),
    };

    const updated = [...credentials, newItem];
    await saveCredsList(updated);

    setNewSite("");
    setNewUsername("");
    setNewPassword("");
  };

  const handleDeleteCredential = async (id: string) => {
    if (window.confirm("Permanently delete this saved login?")) {
      const updated = credentials.filter((c) => c.id !== id);
      await saveCredsList(updated);
    }
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleClearWorkspaceProfile = async () => {
    const confirmClear = window.confirm(
      `Clear all profile data (cookies, storage, cache) for the active workspace: "${activeWorkspaceId}"?\n\nThis will restart the workspace webviews.`
    );
    if (!confirmClear) return;

    setClearingProfile(true);
    try {
      await onClearProfileData(`workspace_${activeWorkspaceId}`);
      alert("Workspace profile data cleared successfully!");
    } catch (err) {
      console.error("Failed to clear workspace profile:", err);
      alert("Error clearing workspace profile.");
    } finally {
      setClearingProfile(false);
    }
  };

  const filteredCreds = credentials.filter(
    (c) =>
      c.site.toLowerCase().includes(search.toLowerCase()) ||
      c.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="settings-screen">
      <div className="settings-card settings-hero-card">
        <div className="settings-hero-icon">
          <Settings2 size={27} strokeWidth={1.7} />
        </div>
        <div>
          <p className="settings-eyebrow">Browser controls</p>
          <h1>Settings</h1>
          <p className="settings-copy">
            Adjust appearance, startup behavior, privacy tools, and secure logins from one scrollable panel.
          </p>
        </div>
      </div>

      <div className="settings-stack">
        <div className="settings-card">
          <div className="settings-card-heading">
            <div>
              <span className="settings-label">Preferences</span>
              <h2>Browser behavior</h2>
            </div>
          </div>

          <div className="settings-grid">
            <div className="settings-option">
              <label>Theme</label>
              <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as ThemeName })}>
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-option">
              <label>Search Engine</label>
              <select
                value={settings.searchEngine}
                onChange={(e) => onChange({ searchEngine: e.target.value as SearchEngine })}
              >
                {ENGINES.map((engine) => (
                  <option key={engine.value} value={engine.value}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-option">
              <label>Home Greeting</label>
              <input
                className="settings-text-input"
                value={settings.homeGreeting}
                placeholder="Your name or a greeting"
                onChange={(e) => onChange({ homeGreeting: e.target.value })}
              />
            </div>

            <div className="settings-option">
              <label>Startup Behavior</label>
              <select
                value={settings.startupBehavior || "previous"}
                onChange={(e) => onChange({ startupBehavior: e.target.value as Settings["startupBehavior"] })}
              >
                <option value="previous">Restore last session (Tabs)</option>
                <option value="home">Open fresh New Tab page</option>
              </select>
            </div>

            <div className="settings-option">
              <label>Downloads Folder</label>
              <input
                className="settings-text-input"
                value={settings.defaultDownloadsPath || "Downloads"}
                placeholder="Downloads folder path"
                onChange={(e) => onChange({ defaultDownloadsPath: e.target.value })}
              />
            </div>

            <div className="settings-toggle-row">
              <div>
                <label htmlFor="ad-block-toggle">Ad & Tracker Shield</label>
                <p>Toggle the built-in shield for supported browsing flows.</p>
              </div>
              <input
                id="ad-block-toggle"
                type="checkbox"
                checked={!!settings.adBlockingEnabled}
                onChange={(e) => onChange({ adBlockingEnabled: e.target.checked })}
              />
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-heading">
            <div>
              <span className="settings-label">Privacy & browsing data</span>
              <h2>Cleanup tools</h2>
            </div>
          </div>

          <div className="settings-actions">
            <button onClick={handleClearWorkspaceProfile} disabled={clearingProfile} className="settings-action-btn danger">
              {clearingProfile ? (
                <>
                  <Loader2 className="animate-spin" size={13} />
                  Wiping data...
                </>
              ) : (
                <>
                  <Shield size={13} />
                  Reset Active Workspace Profile
                </>
              )}
            </button>

            <button
              onClick={() => {
                if (window.confirm("Clear browsing history?")) {
                  onClearHistory();
                  alert("History cleared!");
                }
              }}
              className="settings-action-btn"
            >
              <History size={13} />
              Clear Search & Navigation History
            </button>

            <button
              onClick={() => {
                if (window.confirm("Clear all download records? This won't delete files from disk.")) {
                  onClearDownloads();
                  alert("Download log cleared!");
                }
              }}
              className="settings-action-btn"
            >
              <Download size={13} />
              Clear Downloads History
            </button>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-heading">
            <div>
              <span className="settings-label">Saved logins</span>
              <h2>DPAPI encrypted vault</h2>
            </div>
          </div>

          <form onSubmit={handleAddCredential} className="settings-credential-form">
            <span className="settings-form-kicker">Securely save a login</span>
            <input
              className="settings-text-input"
              value={newSite}
              onChange={(e) => setNewSite(e.target.value)}
              placeholder="Website (e.g. google.com)"
              required
            />
            <div className="settings-credential-row">
              <input
                className="settings-text-input"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username / Email"
                required
              />
              <input
                className="settings-text-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password"
                required
              />
            </div>
            <button type="submit" className="settings-action-btn primary">
              <Plus size={12} />
              Save Login
            </button>
          </form>

          {loadingCreds ? (
            <div className="settings-loading">
              <Loader2 className="animate-spin" size={16} />
              <span>Loading secure logins...</span>
            </div>
          ) : (
            <div className="settings-credentials-wrap">
              <div className="settings-search">
                <Search size={12} />
                <input
                  className="settings-text-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search saved logins..."
                />
              </div>

              {filteredCreds.length === 0 ? (
                <div className="settings-empty-state">
                  {search ? "No matches found" : "No secure credentials saved yet"}
                </div>
              ) : (
                <div className="settings-credential-list">
                  {filteredCreds.map((c) => (
                    <div key={c.id} className="settings-credential-item">
                      <div className="settings-credential-main">
                        <div className="settings-credential-site">{c.site}</div>
                        <div className="settings-credential-meta">
                          <span className="settings-credential-user">{c.username}</span>
                          <span className="settings-credential-dot">•</span>
                          <span
                            className="settings-credential-pass"
                            style={{ fontFamily: visiblePasswords[c.id] ? "monospace" : "inherit" }}
                          >
                            {visiblePasswords[c.id] ? c.password_decrypted : "••••••••"}
                          </span>
                        </div>
                      </div>

                      <div className="settings-credential-actions">
                        <button type="button" onClick={() => togglePasswordVisibility(c.id)} className="settings-icon-btn">
                          {visiblePasswords[c.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button type="button" onClick={() => handleDeleteCredential(c.id)} className="settings-icon-btn danger">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
