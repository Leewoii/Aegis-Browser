import { useEffect, useState } from "react";
import { Eye, EyeOff, Trash2, Plus, Search, Lock, Shield, Loader2 } from "lucide-react";
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
    <div className="list-panel" style={{ paddingBottom: "24px" }}>
      <div className="list-panel-header">
        <h3>Settings</h3>
      </div>

      {/* ── Preferences Section ── */}
      <div className="settings-section" style={{ padding: "0 12px", marginBottom: "20px" }}>
        <h4 style={{ margin: "16px 0 10px 0", color: "#a78bfa", fontSize: "13px" }}>Preferences</h4>
        
        <div className="settings-option" style={{ marginBottom: "12px" }}>
          <label>Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => onChange({ theme: e.target.value as ThemeName })}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-option" style={{ marginBottom: "12px" }}>
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

        <div className="settings-option" style={{ marginBottom: "12px" }}>
          <label>Home Greeting</label>
          <input
            className="settings-text-input"
            value={settings.homeGreeting}
            placeholder="Your name or a greeting"
            onChange={(e) => onChange({ homeGreeting: e.target.value })}
          />
        </div>

        <div className="settings-option" style={{ marginBottom: "12px" }}>
          <label>Startup Behavior</label>
          <select
            value={settings.startupBehavior || "previous"}
            onChange={(e) => onChange({ startupBehavior: e.target.value as Settings["startupBehavior"] })}
          >
            <option value="previous">Restore last session (Tabs)</option>
            <option value="home">Open fresh New Tab page</option>
          </select>
        </div>

        <div className="settings-option" style={{ marginBottom: "12px" }}>
          <label>Downloads Folder</label>
          <input
            className="settings-text-input"
            value={settings.defaultDownloadsPath || "Downloads"}
            placeholder="Downloads folder path"
            onChange={(e) => onChange({ defaultDownloadsPath: e.target.value })}
          />
        </div>

        <div className="settings-option" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <label htmlFor="ad-block-toggle" style={{ cursor: "pointer" }}>Ad & Tracker Shield</label>
          <input
            id="ad-block-toggle"
            type="checkbox"
            style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#a78bfa" }}
            checked={!!settings.adBlockingEnabled}
            onChange={(e) => onChange({ adBlockingEnabled: e.target.checked })}
          />
        </div>
      </div>

      <hr style={{ border: "0", borderTop: "1px solid #232736", margin: "16px 0" }} />

      {/* ── Privacy & Browsing Data Section ── */}
      <div className="settings-section" style={{ padding: "0 12px", marginBottom: "20px" }}>
        <h4 style={{ margin: "0 0 10px 0", color: "#a78bfa", fontSize: "13px" }}>Privacy & Browsing Data</h4>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={handleClearWorkspaceProfile}
            disabled={clearingProfile}
            className="panel-action-btn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: "#3b202e",
              color: "#f43f5e",
              border: "1px solid #5a1e2f",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
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
            className="panel-action-btn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: "#1f2233",
              color: "#e2e8f0",
              border: "1px solid #2d3142",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Clear Search & Navigation History
          </button>

          <button
            onClick={() => {
              if (window.confirm("Clear all download records? This won't delete files from disk.")) {
                onClearDownloads();
                alert("Download log cleared!");
              }
            }}
            className="panel-action-btn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: "#1f2233",
              color: "#e2e8f0",
              border: "1px solid #2d3142",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Clear Downloads History
          </button>
        </div>
      </div>

      <hr style={{ border: "0", borderTop: "1px solid #232736", margin: "16px 0" }} />

      {/* ── DPAPI Credentials Manager Section ── */}
      <div className="settings-section" style={{ padding: "0 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
          <Lock size={13} color="#a78bfa" />
          <h4 style={{ margin: 0, color: "#a78bfa", fontSize: "13px" }}>Saved Logins (DPAPI Encrypted)</h4>
        </div>

        {/* Add credential form */}
        <form onSubmit={handleAddCredential} style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px", background: "#161925", padding: "10px", borderRadius: "6px", border: "1px solid #232736" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#717b99" }}>SECURELY SAVE A LOGIN</span>
          <input
            className="settings-text-input"
            value={newSite}
            onChange={(e) => setNewSite(e.target.value)}
            placeholder="Website (e.g. google.com)"
            required
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              className="settings-text-input"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username / Email"
              required
              style={{ flex: 1, minWidth: 0 }}
            />
            <input
              className="settings-text-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
              required
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <button
            type="submit"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              background: "#3e2e5e",
              color: "#c084fc",
              border: "1px solid #583e85",
              borderRadius: "6px",
              padding: "6px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "4px"
            }}
          >
            <Plus size={12} />
            Save Login
          </button>
        </form>

        {/* Credentials list */}
        {loadingCreds ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0", gap: "8px", color: "#717b99" }}>
            <Loader2 className="animate-spin" size={16} />
            <span style={{ fontSize: "11px" }}>Loading secure logins...</span>
          </div>
        ) : (
          <div>
            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={12} style={{ position: "absolute", left: "8px", top: "9px", color: "#717b99" }} />
              <input
                className="settings-text-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search saved logins..."
                style={{ width: "100%", paddingLeft: "26px" }}
              />
            </div>

            {filteredCreds.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px 0", fontSize: "11px", color: "#717b99", fontStyle: "italic" }}>
                {search ? "No matches found" : "No secure credentials saved yet"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "250px", overflowY: "auto" }}>
                {filteredCreds.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "#161925",
                      border: "1px solid #232736",
                      borderRadius: "6px",
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {c.site}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                        <span style={{ fontSize: "11px", color: "#717b99", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "90px" }}>
                          {c.username}
                        </span>
                        <span style={{ color: "#2d3142" }}>•</span>
                        <span style={{ fontSize: "11px", color: "#a78bfa", fontFamily: visiblePasswords[c.id] ? "monospace" : "inherit" }}>
                          {visiblePasswords[c.id] ? c.password_decrypted : "••••••••"}
                        </span>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", gap: "4px", marginLeft: "8px" }}>
                      <button
                        onClick={() => togglePasswordVisibility(c.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "#717b99",
                          padding: "4px",
                          display: "flex",
                          alignItems: "center"
                        }}
                      >
                        {visiblePasswords[c.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        onClick={() => handleDeleteCredential(c.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "#f43f5e",
                          padding: "4px",
                          display: "flex",
                          alignItems: "center"
                        }}
                      >
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
  );
}
