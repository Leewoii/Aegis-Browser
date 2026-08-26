import { useEffect, useRef, useState } from "react";
import { Terminal as LucideTerminal, Trash2, RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { uid } from "../../utils/browser";
import "xterm/css/xterm.css";

type ShellType = "powershell" | "cmd";

const SHELL_OPTIONS: Array<{ value: ShellType; label: string; exe: string }> = [
  { value: "powershell", label: "PowerShell", exe: "powershell.exe" },
  { value: "cmd", label: "Command Prompt", exe: "cmd.exe" },
];

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const terminalIdRef = useRef<string>(uid());
  const [shell, setShell] = useState<ShellType>("powershell");
  const [isReady, setIsReady] = useState(false);

  // Create / recreate terminal when shell changes
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let xterm: any = null;
    let fitAddon: any = null;

    async function init() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");
      const { WebLinksAddon } = await import("xterm-addon-web-links");

      if (disposed || !containerRef.current) return;

      // Theme-aware xterm colors matching app tokens
      const isNord = document.documentElement.getAttribute("data-theme") === "nord";
      const isAmoled = document.documentElement.getAttribute("data-theme") === "amoled";
      const theme = isNord
        ? {
            background: "#2e3440",
            foreground: "#eceff4",
            cursor: "#88c0d0",
            selectionBackground: "rgba(136, 192, 208, 0.3)",
            black: "#3b4252",
            red: "#bf616a",
            green: "#a3be8c",
            yellow: "#ebcb8b",
            blue: "#81a1c1",
            magenta: "#b48ead",
            cyan: "#88c0d0",
            white: "#e5e9f0",
          }
        : isAmoled
          ? {
              background: "#000000",
              foreground: "#f1f3f9",
              cursor: "#6e9bff",
              selectionBackground: "rgba(110, 155, 255, 0.3)",
            }
          : {
              background: "#0f1117",
              foreground: "#e2e8f0",
              cursor: "#6e9bff",
              selectionBackground: "rgba(110, 155, 255, 0.3)",
              black: "#1a1d2b",
              red: "#f43f5e",
              green: "#34d399",
              yellow: "#fbbf24",
              blue: "#6e9bff",
              magenta: "#a78bfa",
              cyan: "#7de3ff",
              white: "#f1f3f9",
            };

      xterm = new Terminal({
        fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: "block",
        theme,
        allowTransparency: false,
        convertEol: true,
      });

      fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(new WebLinksAddon());

      xterm.open(containerRef.current!);
      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      // Fit after open
      try {
        fitAddon.fit();
      } catch {}

      // Listen for backend output (ConPTY now handles line discipline, so backspace/clear work natively)
      void listen<{ id: string; data: string }>("terminal-output", (e) => {
        if (disposed) return;
        if (e.payload.id !== terminalIdRef.current) return;
        try {
          xterm.write(e.payload.data);
        } catch {}
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

      // Forward user input to backend
      xterm.onData((data: string) => {
        void invoke("write_terminal", { id: terminalIdRef.current, data }).catch(() => undefined);
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            void invoke("resize_terminal", {
              id: terminalIdRef.current,
              cols: dims.cols,
              rows: dims.rows,
            }).catch(() => undefined);
          }
        } catch {}
      });
      if (containerRef.current) resizeObserver.observe(containerRef.current);
      window.addEventListener("resize", () => {
        try {
          fitAddon.fit();
        } catch {}
      });

      // Create backend terminal
      try {
        const dims = fitAddon.proposeDimensions();
        await invoke("create_terminal", {
          id: terminalIdRef.current,
          shell: shell,
          cols: dims?.cols ?? 80,
          rows: dims?.rows ?? 24,
        });
        setIsReady(true);
        xterm.focus();
      } catch (err) {
        xterm.writeln(`\x1b[31mFailed to start ${shell}: ${String(err)}\x1b[0m`);
      }

      // Cleanup resize observer on dispose
      (xterm as any)._resizeObserver = resizeObserver;
    }

    void init();

    return () => {
      disposed = true;
      unlisten?.();
      const rt = xtermRef.current;
      const ro = (rt as any)?._resizeObserver as ResizeObserver | undefined;
      ro?.disconnect();
      try {
        void invoke("close_terminal", { id: terminalIdRef.current }).catch(() => undefined);
      } catch {}
      try {
        rt?.dispose();
      } catch {}
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [shell]);

  const handleClear = () => {
    xtermRef.current?.clear();
  };

  const handleRestart = async () => {
    try {
      await invoke("close_terminal", { id: terminalIdRef.current }).catch(() => undefined);
    } catch {}
    // Generate new id to force re-init
    terminalIdRef.current = uid();
    xtermRef.current?.clear();
    xtermRef.current?.writeln(`\x1b[90mRestarting ${shell}...\x1b[0m`);
    try {
      const dims = fitAddonRef.current?.proposeDimensions();
      await invoke("create_terminal", {
        id: terminalIdRef.current,
        shell,
        cols: dims?.cols ?? 80,
        rows: dims?.rows ?? 24,
      });
      xtermRef.current?.focus();
    } catch (err) {
      xtermRef.current?.writeln(`\x1b[31mFailed to restart: ${String(err)}\x1b[0m`);
    }
  };

  const handleShellChange = (newShell: ShellType) => {
    setShell(newShell);
    setIsReady(false);
    // The effect will recreate the terminal
    terminalIdRef.current = uid();
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar no-drag">
        <div className="terminal-toolbar-left">
          <LucideTerminal size={13} style={{ opacity: 0.85 }} />
          <span className="terminal-title">Terminal</span>
          <select
            className="terminal-shell-select no-drag"
            value={shell}
            onChange={(e) => handleShellChange(e.target.value as ShellType)}
            title="Choose shell"
          >
            {SHELL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {!isReady && <span className="terminal-status">Starting...</span>}
        </div>
        <div className="terminal-toolbar-actions no-drag">
          <button className="terminal-action-btn" onClick={handleRestart} title="Restart terminal">
            <RotateCcw size={13} />
          </button>
          <button className="terminal-action-btn" onClick={handleClear} title="Clear">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-container" ref={containerRef} onClick={() => xtermRef.current?.focus()} />
      <div className="terminal-hint">PowerShell and Command Prompt run natively on Windows. Use the dropdown to switch shells.</div>
    </div>
  );
}
