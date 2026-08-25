import { useEffect, useState } from "react";
import { Copy, Trash2, Check, Loader2 } from "lucide-react";
import { retrieveSecureSecret, storeSecureSecret } from "../../services/storage";

export function NotesPanel() {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Load note from DPAPI secure vault on mount
  useEffect(() => {
    let active = true;
    async function fetchNote() {
      try {
        const val = await retrieveSecureSecret("scratchpad_notes");
        if (active && val !== null) {
          setNote(val);
        }
      } catch (err) {
        console.error("Error loading secure notes:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchNote();
    return () => {
      active = false;
    };
  }, []);

  // Debounced save to DPAPI secure vault on changes
  useEffect(() => {
    if (loading) return;
    const delayDebounceFn = setTimeout(() => {
      void storeSecureSecret("scratchpad_notes", note).catch((err) => {
        console.error("Error saving secure notes:", err);
      });
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [note, loading]);

  const handleCopy = () => {
    if (!note) return;
    navigator.clipboard.writeText(note);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClear = () => {
    if (window.confirm("Clear scratchpad?")) {
      setNote("");
    }
  };

  if (loading) {
    return (
      <div className="notes-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: "#717b99" }}>
          <Loader2 className="animate-spin" size={24} />
          <span style={{ fontSize: "12px" }}>Decrypting notes...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-panel">
      <div className="notes-toolbar">
        <span className="notes-meta">{note.length} chars</span>
        <div className="notes-actions">
          <button className="list-add-btn" onClick={handleCopy} title="Copy all to clipboard">
            {copied ? <Check size={13} color="#28c840" /> : <Copy size={13} />}
          </button>
          <button className="list-clear-btn" onClick={handleClear} title="Clear scratchpad">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <textarea
        className="notes-textarea"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Type quick notes, ideas, code snippets, or links here..."
        spellCheck={false}
      />
    </div>
  );
}
