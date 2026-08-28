import { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal,
  Database as DatabaseIcon,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Trash2,
  Copy,
  Download,
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  Check,
  Globe,
  Cpu,
} from "lucide-react";
import {
  devConsole,
  type DevLogEntry,
  type LogCategory,
  type LogLevel,
  type DataFlowStage,
  type PersistenceSyncState,
  type DevConsoleStats,
} from "../services/devConsole";
import { runStorageDiagnostics, type StorageDiagnosticsResult } from "../services/storage";

export function DevConsoleScreen() {
  const [logs, setLogs] = useState<DevLogEntry[]>(() => devConsole.getLogs());
  const [stats, setStats] = useState<DevConsoleStats>(() => devConsole.getStats());
  const [activeCategory, setActiveCategory] = useState<"all" | LogCategory>("all");
  const [activeLevel, setActiveLevel] = useState<"all" | LogLevel>("all");
  const [activeStage, setActiveStage] = useState<"all" | DataFlowStage>("all");
  const [activePersistenceState, setActivePersistenceState] = useState<"all" | PersistenceSyncState>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [isRunningDiag, setIsRunningDiag] = useState(false);
  const [diagResult, setDiagResult] = useState<StorageDiagnosticsResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hasCopiedAll, setHasCopiedAll] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to real-time logs and stats
  useEffect(() => {
    const unsubLogs = devConsole.subscribe((_entry, all) => {
      setLogs([...all]);
    });
    const unsubStats = devConsole.subscribeStats((newStats) => {
      setStats(newStats);
    });
    return () => {
      unsubLogs();
      unsubStats();
    };
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClear = () => {
    devConsole.clear();
    setLogs([]);
    setExpandedLogIds(new Set());
  };

  const handleRunDiagnostics = async () => {
    setIsRunningDiag(true);
    try {
      const res = await runStorageDiagnostics();
      setDiagResult(res);
    } catch {
      // Handled inside runStorageDiagnostics and logged to devConsole
    } finally {
      setIsRunningDiag(false);
    }
  };

  const handleCopyLog = (log: DevLogEntry) => {
    const payload = JSON.stringify(log, null, 2);
    void navigator.clipboard.writeText(payload);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleCopyAll = () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        stats,
        diagResult,
        logs: filteredLogs,
      },
      null,
      2,
    );
    void navigator.clipboard.writeText(payload);
    setHasCopiedAll(true);
    setTimeout(() => setHasCopiedAll(false), 2000);
  };

  const handleExportJson = () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        stats,
        diagResult,
        logs,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aegis-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter logs based on user controls
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (activeCategory !== "all" && log.category !== activeCategory) return false;
      if (activeLevel !== "all" && log.level !== activeLevel) return false;
      if (activeStage !== "all" && log.stage !== activeStage) return false;
      if (activePersistenceState !== "all" && log.persistenceState !== activePersistenceState) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchTitle = log.title.toLowerCase().includes(query);
        const matchMessage = log.message.toLowerCase().includes(query);
        const matchSql = log.sqlQuery?.toLowerCase().includes(query);
        const matchUrl = log.url?.toLowerCase().includes(query);
        const matchStack = log.stack?.toLowerCase().includes(query);
        const matchDetails =
          log.details && typeof log.details === "object"
            ? JSON.stringify(log.details).toLowerCase().includes(query)
            : false;
        if (!matchTitle && !matchMessage && !matchSql && !matchUrl && !matchStack && !matchDetails) {
          return false;
        }
      }
      return true;
    });
  }, [logs, activeCategory, activeLevel, activeStage, activePersistenceState, searchQuery]);

  return (
    <section className="dev-console-screen">
      {/* Top Header */}
      <header className="dev-console-header">
        <div className="dev-console-title-area">
          <div className="dev-console-hero-icon">
            <Terminal size={26} strokeWidth={1.8} />
          </div>
          <div>
            <div className="dev-console-eyebrow">
              <span>Developer & Troubleshooting Console</span>
              <span className="dev-console-live-tag">
                <span className="live-dot" /> Live Telemetry
              </span>
            </div>
            <h1>System & Persistence Diagnostics</h1>
            <p className="dev-console-subtitle">
              Monitor browser exceptions, browsed-site JS/console errors, failed API requests (inc. Updates), SQLite/Settings vault, and persistence sync in real time.
            </p>
          </div>
        </div>

        <div className="dev-console-top-actions">
          <button
            className="dev-console-btn primary"
            onClick={() => void handleRunDiagnostics()}
            disabled={isRunningDiag}
            title="Execute round-trip SQLite read/write and schema validation test"
          >
            <RefreshCw size={14} className={isRunningDiag ? "dev-spin" : ""} />
            {isRunningDiag ? "Testing DB..." : "Test SQLite Diagnostics"}
          </button>
          <button
            className="dev-console-btn"
            onClick={handleCopyAll}
            title="Copy filtered logs as JSON"
          >
            {hasCopiedAll ? <Check size={14} className="success-icon" /> : <Copy size={14} />}
            {hasCopiedAll ? "Copied All" : "Copy JSON"}
          </button>
          <button
            className="dev-console-btn"
            onClick={handleExportJson}
            title="Export full diagnostic report"
          >
            <Download size={14} />
            Export Log
          </button>
          <button
            className="dev-console-btn danger"
            onClick={handleClear}
            title="Clear console event buffer"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </header>

      {/* Overview Metric Cards */}
      <div className="dev-console-metrics-grid">
        {/* DB Health */}
        <div className={`dev-metric-card ${stats.dbStatus === "error" ? "status-error" : "status-ok"}`}>
          <div className="metric-icon-wrap">
            <DatabaseIcon size={18} />
          </div>
          <div className="metric-info">
            <span className="metric-label">SQLite Database</span>
            <div className="metric-main-val">
              <span className={`status-indicator-dot ${stats.dbStatus}`} />
              <strong>{stats.dbStatus.toUpperCase()}</strong>
              <small className="metric-sub-detail">Aegis.db</small>
            </div>
            <span className="metric-desc">
              {stats.lastDbError ? `Error: ${stats.lastDbError.slice(0, 45)}...` : "tauri-plugin-sql connection active"}
            </span>
          </div>
        </div>

        {/* Persistence Sync Pipeline */}
        <div className="dev-metric-card">
          <div className="metric-icon-wrap">
            <ArrowRightLeft size={18} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Data Persistence Pipeline</span>
            <div className="metric-main-val">
              <span className="sync-badge committed" title="Committed to SQLite on disk">
                <Check size={12} /> {stats.dbCommitted} DB Writes
              </span>
              {stats.inMemoryOnly > 0 && (
                <span className="sync-badge pending" title="Temporarily stored in React state only">
                  {stats.inMemoryOnly} In-Memory
                </span>
              )}
              {stats.dbFailed > 0 && (
                <span className="sync-badge failed" title="Database writes that failed">
                  {stats.dbFailed} Failed
                </span>
              )}
            </div>
            <span className="metric-desc">
              Flow: UI → Frontend State → SQLite Storage
            </span>
          </div>
        </div>

        {/* Errors & Warnings */}
        <div className={`dev-metric-card ${stats.errors > 0 ? "status-error" : ""}`}>
          <div className="metric-icon-wrap">
            {stats.errors > 0 ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          </div>
          <div className="metric-info">
            <span className="metric-label">Exceptions & Warnings</span>
            <div className="metric-main-val">
              <strong className={stats.errors > 0 ? "text-error" : "text-success"}>
                {stats.errors} Errors
              </strong>
              <span className="metric-separator">•</span>
              <span className="text-warning">{stats.warnings} Warnings</span>
            </div>
            <span className="metric-desc">
              {stats.errors > 0 ? "Errors detected in runtime" : "No unresolved runtime exceptions"}
            </span>
          </div>
        </div>

        {/* Total Event Stream */}
        <div className="dev-metric-card">
          <div className="metric-icon-wrap">
            <Layers size={18} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Telemetry Events</span>
            <div className="metric-main-val">
              <strong>{logs.length} Events</strong>
              <small className="metric-sub-detail">Buffered</small>
            </div>
            <span className="metric-desc">
              Auto-scroll: {autoScroll ? "ON" : "OFF"}
            </span>
          </div>
        </div>
      </div>

      {/* Live SQLite Table Counts banner if diagnostics was executed */}
      {diagResult && (
        <div className="dev-diag-banner">
          <div className="dev-diag-title">
            <DatabaseIcon size={14} />
            <span>SQLite Table Record Counts (Verified in {diagResult.latencyMs}ms):</span>
          </div>
          <div className="dev-diag-pills">
            {Object.entries(diagResult.tables).map(([table, count]) => (
              <span key={table} className="diag-pill">
                <strong>{table}:</strong> {count >= 0 ? count : "Error"}
              </span>
            ))}
            <span className={`diag-pill ${diagResult.encryptionWorking ? "success" : "failed"}`}>
              <strong>DPAPI Vault:</strong> {diagResult.encryptionWorking ? "PASS" : "FAIL"}
            </span>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="dev-console-toolbar">
        {/* Category Tabs */}
        <div className="dev-filter-group category-tabs">
          <button
            className={`filter-pill ${activeCategory === "all" ? "active" : ""}`}
            onClick={() => setActiveCategory("all")}
          >
            All Categories ({logs.length})
          </button>
          <button
            className={`filter-pill frontend ${activeCategory === "frontend" ? "active" : ""}`}
            onClick={() => setActiveCategory("frontend")}
          >
            <Cpu size={12} /> Frontend
          </button>
          <button
            className={`filter-pill database ${activeCategory === "database" ? "active" : ""}`}
            onClick={() => setActiveCategory("database")}
          >
            <DatabaseIcon size={12} /> Database
          </button>
          <button
            className={`filter-pill api ${activeCategory === "api" ? "active" : ""}`}
            onClick={() => setActiveCategory("api")}
          >
            <Globe size={12} /> API & Network
          </button>
          <button
            className={`filter-pill persistence ${activeCategory === "persistence" ? "active" : ""}`}
            onClick={() => setActiveCategory("persistence")}
          >
            <ArrowRightLeft size={12} /> Persistence / State
          </button>
          <button
            className={`filter-pill webview ${activeCategory === "webview" ? "active" : ""}`}
            onClick={() => setActiveCategory("webview")}
          >
            <Globe size={12} /> WebView / Site
          </button>
        </div>

        {/* Severity Filters */}
        <div className="dev-filter-group level-filters">
          <button
            className={`level-pill ${activeLevel === "all" ? "active" : ""}`}
            onClick={() => setActiveLevel("all")}
          >
            All Levels
          </button>
          <button
            className={`level-pill error ${activeLevel === "error" ? "active" : ""}`}
            onClick={() => setActiveLevel("error")}
          >
            <AlertCircle size={12} /> Errors ({stats.errors})
          </button>
          <button
            className={`level-pill warn ${activeLevel === "warn" ? "active" : ""}`}
            onClick={() => setActiveLevel("warn")}
          >
            <AlertTriangle size={12} /> Warnings ({stats.warnings})
          </button>
          <button
            className={`level-pill success ${activeLevel === "success" ? "active" : ""}`}
            onClick={() => setActiveLevel("success")}
          >
            <CheckCircle2 size={12} /> Success
          </button>
          <button
            className={`level-pill info ${activeLevel === "info" ? "active" : ""}`}
            onClick={() => setActiveLevel("info")}
          >
            <Info size={12} /> Info
          </button>
        </div>

        {/* Search Input & Auto-scroll Toggle */}
        <div className="dev-toolbar-right">
          <div className="dev-search-box">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              placeholder="Filter by title, SQL, URL, error, or JSON..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery("")}>
                ×
              </button>
            )}
          </div>

          <label className="dev-auto-scroll-toggle" title="Toggle automatic scrolling on new events">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Log Feed */}
      <div className="dev-console-feed" role="log" aria-live="polite">
        {filteredLogs.length === 0 ? (
          <div className="dev-console-empty">
            <Terminal size={36} strokeWidth={1.5} />
            <h3>No events match current filter</h3>
            <p>
              {logs.length === 0
                ? "Waiting for runtime events, database transactions, or network requests."
                : "Try clearing search keywords or selecting another category/level filter."}
            </p>
            {logs.length > 0 && (
              <button
                className="dev-console-btn"
                onClick={() => {
                  setActiveCategory("all");
                  setActiveLevel("all");
                  setActiveStage("all");
                  setActivePersistenceState("all");
                  setSearchQuery("");
                }}
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogIds.has(log.id);
            const isCopied = copiedId === log.id;

            return (
              <article
                key={log.id}
                className={`dev-log-card level-${log.level} cat-${log.category} ${isExpanded ? "expanded" : ""}`}
              >
                <div
                  className="dev-log-summary-row"
                  onClick={() => toggleExpand(log.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleExpand(log.id)}
                >
                  <span className="log-expand-icon">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>

                  {/* Timestamp */}
                  <span className="log-time" title={new Date(log.timestamp).toLocaleString()}>
                    {log.timeFormatted}
                  </span>

                  {/* Category badge */}
                  <span className={`log-cat-badge ${log.category}`}>
                    {log.category.toUpperCase()}
                  </span>

                  {/* Level badge */}
                  <span className={`log-level-badge ${log.level}`}>
                    {log.level === "error" && <AlertCircle size={11} />}
                    {log.level === "warn" && <AlertTriangle size={11} />}
                    {log.level === "success" && <CheckCircle2 size={11} />}
                    {log.level === "info" && <Info size={11} />}
                    {log.level.toUpperCase()}
                  </span>

                  {/* Stage badge */}
                  {log.stage && (
                    <span className="log-stage-badge">
                      {log.stage.replace("_", " → ").toUpperCase()}
                    </span>
                  )}

                  {/* Persistence State badge */}
                  {log.persistenceState && (
                    <span className={`log-persist-badge ${log.persistenceState}`}>
                      {log.persistenceState === "db_committed" && "✓ DB COMMITTED"}
                      {log.persistenceState === "in_memory" && "⏱ IN-MEMORY ONLY"}
                      {log.persistenceState === "persisting" && "⏳ PERSISTING"}
                      {log.persistenceState === "db_failed" && "⚠ DB FAILED"}
                    </span>
                  )}

                  {/* Latency */}
                  {log.durationMs !== undefined && (
                    <span className="log-duration-badge">{log.durationMs}ms</span>
                  )}

                  {/* Title & Message */}
                  <div className="log-content-preview">
                    <strong className="log-title">{log.title}</strong>
                    <span className="log-message-preview">{log.message}</span>
                  </div>

                  {/* Quick Copy Button */}
                  <button
                    className="log-row-copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyLog(log);
                    }}
                    title="Copy event payload"
                  >
                    {isCopied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>

                {/* Expanded Details Pane */}
                {isExpanded && (
                  <div className="dev-log-details-pane">
                    {/* SQL Query Box */}
                    {log.sqlQuery && (
                      <div className="detail-section">
                        <div className="detail-section-header">
                          <DatabaseIcon size={12} />
                          <span>SQL Query & Bindings</span>
                        </div>
                        <pre className="code-block sql-code">
                          <code>{log.sqlQuery}</code>
                        </pre>
                        {log.sqlParams && log.sqlParams.length > 0 && (
                          <div className="sql-params-list">
                            <span className="params-label">Parameters:</span>
                            <code>{JSON.stringify(log.sqlParams)}</code>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Network / URL Details */}
                    {log.url && (
                      <div className="detail-section">
                        <div className="detail-section-header">
                          <Globe size={12} />
                          <span>HTTP Request Information</span>
                        </div>
                        <div className="http-details-row">
                          <span className="http-method">{log.httpMethod || "GET"}</span>
                          <code className="http-url">{log.url}</code>
                          {log.httpStatus !== undefined && (
                            <span className={`http-status ${log.httpStatus >= 400 ? "err" : "ok"}`}>
                              Status: {log.httpStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Stack Trace */}
                    {log.stack && (
                      <div className="detail-section">
                        <div className="detail-section-header error-header">
                          <AlertCircle size={12} />
                          <span>Stack Trace</span>
                        </div>
                        <pre className="code-block stack-code">
                          <code>{log.stack}</code>
                        </pre>
                      </div>
                    )}

                    {/* Generic Details Object */}
                    {log.details !== undefined && log.details !== null && (
                      <div className="detail-section">
                        <div className="detail-section-header">
                          <Layers size={12} />
                          <span>Payload & Context</span>
                        </div>
                        <pre className="code-block json-code">
                          <code>
                            {typeof log.details === "object"
                              ? JSON.stringify(log.details, null, 2)
                              : String(log.details)}
                          </code>
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </section>
  );
}
