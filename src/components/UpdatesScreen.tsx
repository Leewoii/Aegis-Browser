import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Check, Download, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { devConsole } from "../services/devConsole";

import packageJson from "../../package.json";

type UpdateState = "checking" | "current" | "available" | "downloading" | "error";

function releaseNotes(notes?: string): string[] {
  return (notes || "This release includes improvements and fixes.")
    .split(/\r?\n/)
    .map((note) => note.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function UpdatesScreen() {
  const [currentVersion, setCurrentVersion] = useState(packageJson.version || "1.2.2");
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>("checking");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const checkForUpdates = async () => {
    setState("checking");
    setError("");
    setProgress(null);

    // Always resolve current version independently — a failing updater check (404 in dev / no release yet) must not hide the installed version.
    try {
      const version = await getVersion();
      if (version) setCurrentVersion(version);
      devConsole.updates("info", "Update Version Resolved", `Current version: ${version || packageJson.version}`, { version });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      devConsole.updates("warn", "Get Version Fallback", `Failed to resolve Tauri version, using package.json fallback: ${msg}`, { error: msg, stack: err instanceof Error ? err.stack : undefined });
      // Fallback to package.json version
    }

    try {
      const availableUpdate = await check();
      setUpdate(availableUpdate);
      setState(availableUpdate ? "available" : "current");
      if (availableUpdate) {
        devConsole.updates("info", "Update Available", `Update ${availableUpdate.version} available (current ${currentVersion})`, { available: availableUpdate.version, current: currentVersion });
      } else {
        devConsole.updates("info", "Up To Date", `Aegis ${currentVersion} is current — no update found`, { current: currentVersion });
      }
    } catch (reason) {
      setUpdate(null);
      setState("error");
      let message =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
          ? reason.message
          : "Unable to check for updates.";

      if (
        message.toLowerCase().includes("could not fetch a valid release json") ||
        message.includes("404")
      ) {
        message =
          "No release manifest found on GitHub. If you haven't published a release yet or are running in development mode, this is expected.";
      }

      setError(message);
      devConsole.updates("error", "Update Check Failed", message, { error: reason, stack: reason instanceof Error ? reason.stack : undefined });
    }
  };

  useEffect(() => {
    void checkForUpdates();
  }, []);

  const installUpdate = async () => {
    if (!update) return;
    setState("downloading");
    setError("");
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(total ? Math.round((downloaded / total) * 100) : null);
        }
      });
    } catch (reason) {
      setState("error");
      let msg = reason instanceof Error ? reason.message : String(reason) || "The update could not be installed.";
      const isSigMismatch = msg.toLowerCase().includes("different key") || msg.toLowerCase().includes("signature");
      if (isSigMismatch) {
        msg =
          "Signature mismatch: The update was signed with a different private key than this build's public key. " +
          "Fixed in tauri.conf.json (RWRr → RWSr) for next release — this installed build (v" +
          currentVersion +
          ") must be reinstalled manually from GitHub Releases. Download the latest MSI/NSIS and run it; future auto-updates will work.";
        devConsole.updates(
          "error",
          "Update Install Failed — PubKey Mismatch (Manual Reinstall Required)",
          msg,
          {
            error: reason,
            stack: reason instanceof Error ? reason.stack : undefined,
            hint: "tauri.conf.json pubkey was RWRrPKyp... but release was signed with RWSrPKyp... (aegis.key.pub). Corrected to RWSr for next build. Current binary needs manual reinstall.",
            currentPubkey: "RWSrPKypWBaPnHLnlpPBmcwV0aGIkj3+mFIWMnckYHf/oYla6Mz6vu+J (9C8F1658A9AC3CAB)",
            recoveryUrl: "https://github.com/Leewoii/Aegis-Browser/releases/latest",
          },
        );
      } else {
        devConsole.updates("error", "Update Install Failed", msg, { error: reason, stack: reason instanceof Error ? reason.stack : undefined });
      }
      setError(msg);
    }
  };

  const notes = releaseNotes(update?.body);

  return (
    <section className="updates-screen">
      <div className="updates-card">
        <div className="updates-hero-icon"><ShieldCheck size={27} strokeWidth={1.7} /></div>
        <div>
          <p className="updates-eyebrow">Aegis</p>
          <h1>Application updates</h1>
          <p className="updates-copy">Secure, signed updates are installed through the official Aegis release channel.</p>
        </div>
      </div>

      <div className="updates-version-card">
        <div>
          <span className="updates-label">Current version</span>
          <strong>v{currentVersion}</strong>
        </div>
        {update && <span className="updates-arrow">v{currentVersion} <span>→</span> v{update.version}</span>}
      </div>

      {state === "checking" && <p className="updates-status"><RefreshCw size={15} className="updates-spin" /> Checking for updates...</p>}
      {state === "current" && <p className="updates-status success"><Check size={16} /> Aegis is up to date.</p>}
      {state === "error" && (
        <div className="updates-error-block">
          <p className="updates-status error">{error}</p>
          {error.includes("Signature mismatch") && (
            <a
              href="https://github.com/Leewoii/Aegis-Browser/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="updates-manual-link"
            >
              Open GitHub Releases to download manually →
            </a>
          )}
        </div>
      )}

      {update && state !== "checking" && (
        <div className="updates-release">
          <div className="updates-release-heading">
            <div>
              <span className="updates-label">Update available</span>
              <h2>Version {update.version}</h2>
            </div>
            {state === "available" && (
              <button className="updates-install-button" onClick={() => void installUpdate()}>
                <Download size={16} /> Download and install
              </button>
            )}
          </div>
          {state === "downloading" && (
            <div className="updates-progress" aria-label="Downloading update">
              <span style={{ width: progress === null ? "35%" : `${progress}%` }} />
              <small>{progress === null ? "Preparing update..." : `Downloading ${progress}%`}</small>
            </div>
          )}
          <div className="updates-notes">
            <p><Sparkles size={15} /> What’s new</p>
            <ul>{notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul>
          </div>
        </div>
      )}

      <button className="updates-check-button" onClick={() => void checkForUpdates()} disabled={state === "checking" || state === "downloading"}>
        <RefreshCw size={15} className={state === "checking" ? "updates-spin" : ""} /> Check again
      </button>
    </section>
  );
}
