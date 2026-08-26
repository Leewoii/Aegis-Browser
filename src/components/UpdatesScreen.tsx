import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Check, Download, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

type UpdateState = "checking" | "current" | "available" | "downloading" | "error";

function releaseNotes(notes?: string): string[] {
  return (notes || "This release includes improvements and fixes.")
    .split(/\r?\n/)
    .map((note) => note.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function UpdatesScreen() {
  const [currentVersion, setCurrentVersion] = useState("1.0.0");
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>("checking");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const checkForUpdates = async () => {
    setState("checking");
    setError("");
    setProgress(null);
    try {
      const [version, availableUpdate] = await Promise.all([getVersion(), check()]);
      setCurrentVersion(version);
      setUpdate(availableUpdate);
      setState(availableUpdate ? "available" : "current");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : "Unable to check for updates.");
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
      setError(reason instanceof Error ? reason.message : "The update could not be installed.");
    }
  };

  const notes = releaseNotes(update?.body);

  return (
    <section className="updates-screen">
      <div className="updates-card">
        <div className="updates-hero-icon"><ShieldCheck size={27} strokeWidth={1.7} /></div>
        <div>
          <p className="updates-eyebrow">Aegis Browser</p>
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
      {state === "current" && <p className="updates-status success"><Check size={16} /> Aegis Browser is up to date.</p>}
      {state === "error" && <p className="updates-status error">{error}</p>}

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
