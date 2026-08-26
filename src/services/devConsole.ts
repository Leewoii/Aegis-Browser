/**
 * Developer & Debugging Console Service for Aegis Browser.
 * Intercepts, records, and categorizes real application runtime events:
 * - Frontend errors and warnings (console.error, console.warn, window.onerror, unhandledrejection)
 * - Network and API requests (fetch interceptor, HTTP status codes, response errors, latency)
 * - Database operations (SQLite queries, connection status, table migrations, execution latency, errors)
 * - Persistence & session state transitions (UI state -> In-Memory -> DB Committed -> DB Failed -> Re-fetch)
 */

export type LogCategory = "frontend" | "api" | "database" | "persistence";
export type LogLevel = "info" | "warn" | "error" | "success";
export type DataFlowStage =
  | "ui"
  | "frontend_state"
  | "api_backend"
  | "database"
  | "persisted_data"
  | "reload_refetch";

export type PersistenceSyncState =
  | "untracked"
  | "in_memory"
  | "persisting"
  | "db_committed"
  | "db_failed";

export type DevLogEntry = {
  id: string;
  timestamp: number;
  timeFormatted: string;
  category: LogCategory;
  level: LogLevel;
  title: string;
  message: string;
  stage?: DataFlowStage;
  persistenceState?: PersistenceSyncState;
  entity?:
    | "tabs"
    | "workspaces"
    | "tab_groups"
    | "bookmarks"
    | "history"
    | "settings"
    | "sidebar"
    | "downloads"
    | "vault"
    | "session"
    | "network"
    | "system";
  durationMs?: number;
  sqlQuery?: string;
  sqlParams?: unknown[];
  httpStatus?: number;
  httpMethod?: string;
  url?: string;
  stack?: string;
  details?: unknown;
};

export type DevConsoleStats = {
  total: number;
  errors: number;
  warnings: number;
  dbCommitted: number;
  inMemoryOnly: number;
  dbFailed: number;
  dbStatus: "connected" | "connecting" | "error" | "uninitialized";
  lastDbError?: string;
};

type LogListener = (entry: DevLogEntry, allEntries: DevLogEntry[]) => void;
type StatsListener = (stats: DevConsoleStats) => void;

const MAX_LOGS = 1500;

function formatTimestamp(d = new Date()): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${hh}:${mm}:${ss}.${ms}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

class DevConsoleManager {
  private logs: DevLogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private statsListeners: Set<StatsListener> = new Set();
  private isInitialized = false;
  private dbStatus: "connected" | "connecting" | "error" | "uninitialized" = "uninitialized";
  private lastDbError?: string;

  constructor() {
    this.initGlobalInterceptors();
  }

  public initGlobalInterceptors(): void {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    // 1. Capture unhandled JavaScript exceptions
    window.addEventListener("error", (event) => {
      const errorObj = event.error as Error | undefined;
      this.frontend(
        "error",
        "Unhandled Browser Exception",
        event.message || "An unhandled JavaScript error occurred.",
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: errorObj ? errorObj.message : String(event.error),
        },
        errorObj?.stack,
      );
    });

    // 2. Capture unhandled Promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      let message = "Unhandled Promise Rejection";
      let stack: string | undefined;

      if (reason instanceof Error) {
        message = reason.message;
        stack = reason.stack;
      } else if (typeof reason === "string") {
        message = reason;
      } else if (reason && typeof reason === "object") {
        try {
          message = JSON.stringify(reason);
        } catch {
          message = String(reason);
        }
      }

      this.frontend(
        "error",
        "Unhandled Promise Rejection",
        message,
        { reason },
        stack,
      );
    });

    // 3. Intercept console.error and console.warn
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      originalConsoleError.apply(console, args);
      try {
        const firstArg = args[0];
        const title =
          typeof firstArg === "string"
            ? firstArg.slice(0, 80)
            : firstArg instanceof Error
            ? firstArg.name
            : "Console Error";
        const message = args
          .map((a) => (a instanceof Error ? a.message : typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        const stack = firstArg instanceof Error ? firstArg.stack : new Error().stack;

        this.frontend("error", title, message, { args }, stack);
      } catch {
        // Prevent recursive logging failure
      }
    };

    const originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      originalConsoleWarn.apply(console, args);
      try {
        const firstArg = args[0];
        const title = typeof firstArg === "string" ? firstArg.slice(0, 80) : "Console Warning";
        const message = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");

        this.frontend("warn", title, message, { args });
      } catch {
        // Prevent recursive logging failure
      }
    };

    // 4. Intercept window.fetch for network diagnostics
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const startTime = performance.now();
      const input = args[0];
      const init = args[1];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();

      try {
        const response = await originalFetch.apply(window, args);
        const durationMs = Math.round((performance.now() - startTime) * 10) / 10;

        if (!response.ok) {
          this.api(
            method,
            url,
            response.status,
            durationMs,
            `HTTP ${response.status} ${response.statusText}`,
            {
              headers: Object.fromEntries(response.headers.entries()),
              type: response.type,
            },
          );
        } else if (url.includes("api") || url.includes("github.com") || url.includes("update")) {
          // Log notable API requests even on success for traceability
          this.log({
            id: uid(),
            timestamp: Date.now(),
            timeFormatted: formatTimestamp(),
            category: "api",
            level: "info",
            title: `HTTP ${response.status} (${method})`,
            message: `${method} ${url}`,
            httpMethod: method,
            url,
            httpStatus: response.status,
            durationMs,
            stage: "api_backend",
          });
        }

        return response;
      } catch (fetchError) {
        const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
        const errMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        this.api(
          method,
          url,
          0,
          durationMs,
          `Network/Fetch Error: ${errMessage}`,
          { error: fetchError },
          fetchError instanceof Error ? fetchError.stack : undefined,
        );
        throw fetchError;
      }
    };

    this.system("System Initialized", "Diagnostics and debugging telemetry active.");
  }

  public log(entry: DevLogEntry): void {
    if (this.logs.length >= MAX_LOGS) {
      this.logs.shift();
    }
    this.logs.push(entry);

    if (entry.category === "database") {
      if (entry.level === "error") {
        this.dbStatus = "error";
        this.lastDbError = entry.message;
      } else if (this.dbStatus === "uninitialized" || this.dbStatus === "connecting") {
        this.dbStatus = "connected";
      }
    }

    const currentStats = this.getStats();

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(entry, this.logs);
      } catch {
        // ignore listener errors
      }
    });

    this.statsListeners.forEach((listener) => {
      try {
        listener(currentStats);
      } catch {
        // ignore listener errors
      }
    });
  }

  // --- Category helpers ---

  public frontend(
    level: LogLevel,
    title: string,
    message: string,
    details?: unknown,
    stack?: string,
  ): void {
    this.log({
      id: uid(),
      timestamp: Date.now(),
      timeFormatted: formatTimestamp(),
      category: "frontend",
      level,
      title,
      message,
      stage: "ui",
      details,
      stack,
    });
  }

  public api(
    method: string,
    url: string,
    status: number,
    durationMs?: number,
    error?: string,
    details?: unknown,
    stack?: string,
  ): void {
    const isError = status === 0 || status >= 400;
    this.log({
      id: uid(),
      timestamp: Date.now(),
      timeFormatted: formatTimestamp(),
      category: "api",
      level: isError ? "error" : "info",
      title: `${method} ${status ? `(${status})` : "(Network Error)"}`,
      message: error || `${method} ${url}`,
      httpMethod: method,
      url,
      httpStatus: status,
      durationMs,
      stage: "api_backend",
      details,
      stack,
    });
  }

  public db(params: {
    operation: string;
    tableOrQuery: string;
    status: "success" | "error";
    error?: string | Error;
    rowsAffectedOrCount?: number;
    durationMs?: number;
    persistenceState?: PersistenceSyncState;
    entity?: DevLogEntry["entity"];
    sqlQuery?: string;
    sqlParams?: unknown[];
    details?: unknown;
    stack?: string;
  }): void {
    const isError = params.status === "error";
    const errorMessage = params.error
      ? params.error instanceof Error
        ? params.error.message
        : String(params.error)
      : undefined;

    this.log({
      id: uid(),
      timestamp: Date.now(),
      timeFormatted: formatTimestamp(),
      category: "database",
      level: isError ? "error" : "info",
      title: `SQLite ${params.operation.toUpperCase()} ${isError ? "FAILED" : "OK"}`,
      message: errorMessage || `${params.operation} on ${params.tableOrQuery}`,
      stage: "database",
      persistenceState: params.persistenceState || (isError ? "db_failed" : "db_committed"),
      entity: params.entity,
      durationMs: params.durationMs,
      sqlQuery: params.sqlQuery || params.tableOrQuery,
      sqlParams: params.sqlParams,
      details: {
        rows: params.rowsAffectedOrCount,
        ...((params.details as Record<string, unknown>) || {}),
      },
      stack: params.error instanceof Error ? params.error.stack : params.stack,
    });
  }

  public persistence(params: {
    entity: NonNullable<DevLogEntry["entity"]>;
    state: PersistenceSyncState;
    stage: DataFlowStage;
    action: string;
    description: string;
    durationMs?: number;
    details?: unknown;
    error?: string | Error;
  }): void {
    const isError = params.state === "db_failed" || !!params.error;
    const isSuccess = params.state === "db_committed";
    const level: LogLevel = isError ? "error" : isSuccess ? "success" : "info";

    const errMessage = params.error
      ? params.error instanceof Error
        ? params.error.message
        : String(params.error)
      : undefined;

    this.log({
      id: uid(),
      timestamp: Date.now(),
      timeFormatted: formatTimestamp(),
      category: "persistence",
      level,
      title: `[${params.entity.toUpperCase()}] ${params.action} (${params.state.replace("_", " ").toUpperCase()})`,
      message: errMessage || params.description,
      stage: params.stage,
      persistenceState: params.state,
      entity: params.entity,
      durationMs: params.durationMs,
      details: params.details,
      stack: params.error instanceof Error ? params.error.stack : undefined,
    });
  }

  public system(title: string, message: string, details?: unknown): void {
    this.log({
      id: uid(),
      timestamp: Date.now(),
      timeFormatted: formatTimestamp(),
      category: "frontend",
      level: "info",
      title,
      message,
      stage: "ui",
      details,
    });
  }

  // --- Management & Subscriptions ---

  public getLogs(): DevLogEntry[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs = [];
    const stats = this.getStats();
    this.listeners.forEach((l) => l({} as DevLogEntry, []));
    this.statsListeners.forEach((l) => l(stats));
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => {
      this.statsListeners.delete(listener);
    };
  }

  public setDbStatus(status: "connected" | "connecting" | "error" | "uninitialized", error?: string): void {
    this.dbStatus = status;
    if (error) this.lastDbError = error;
    const stats = this.getStats();
    this.statsListeners.forEach((l) => l(stats));
  }

  public getStats(): DevConsoleStats {
    let errors = 0;
    let warnings = 0;
    let dbCommitted = 0;
    let inMemoryOnly = 0;
    let dbFailed = 0;

    for (const log of this.logs) {
      if (log.level === "error") errors++;
      if (log.level === "warn") warnings++;
      if (log.persistenceState === "db_committed") dbCommitted++;
      if (log.persistenceState === "in_memory") inMemoryOnly++;
      if (log.persistenceState === "db_failed") dbFailed++;
    }

    return {
      total: this.logs.length,
      errors,
      warnings,
      dbCommitted,
      inMemoryOnly,
      dbFailed,
      dbStatus: this.dbStatus,
      lastDbError: this.lastDbError,
    };
  }
}

export const devConsole = new DevConsoleManager();
