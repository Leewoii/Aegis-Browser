import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, Mic, ScanSearch, Search } from "lucide-react";

export interface Suggestion {
  title: string;
  url: string;
}

interface OmniboxProps {
  url: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (value: string) => void;
  suggestions: Suggestion[];
  onScan: () => void;
  onVoice: () => void;
  isListening: boolean;
}

export function Omnibox({
  url,
  query,
  onQueryChange,
  onSubmit,
  suggestions,
  onScan,
  onVoice,
  isListening,
}: OmniboxProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const visible = showSuggestions && suggestions.length > 0;

  function selectSuggestion(selected: string) {
    setShowSuggestions(false);
    onQueryChange("");
    onSubmit(selected);
  }

  return (
    <div className="omnibox-wrapper" ref={wrapperRef}>
      <form
        className="omnibox"
        onSubmit={(event) => {
          event.preventDefault();
          setShowSuggestions(false);
          onSubmit(query || url || "");
        }}
      >
        <Search size={15} className="omnibox-icon" />
        <input
          id="omnibox"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            if (event.target.value.trim()) setShowSuggestions(true);
          }}
          onFocus={() => {
            if (query.trim()) setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowSuggestions(false);
          }}
          placeholder={url || "Search or enter address"}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="omnibox-chip no-drag" onClick={onScan} title="Scan QR code or barcode">
          <ScanSearch size={14} />
        </button>
        <button
          type="button"
          className={`omnibox-chip voice no-drag ${isListening ? "listening" : ""}`}
          onClick={onVoice}
          aria-label="Voice search"
          title="Voice search"
        >
          <Mic size={14} />
        </button>
      </form>

      {visible && (
        <div className="omnibox-suggestions">
          {suggestions.map((s) => (
            <button
              key={s.url}
              className="suggestion-item no-drag"
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(s.url);
              }}
            >
              <Globe size={12} />
              <span className="suggestion-title">{s.title}</span>
              <span className="suggestion-url">{s.url}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function useSuggestions(
  query: string,
  historyEntries: Array<{ url: string; title: string }>,
  bookmarks: Array<{ url: string; title: string }>,
): Suggestion[] {
  return useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const matches = new Map<string, Suggestion>();

    for (const entry of historyEntries) {
      if (entry.url.toLowerCase().includes(q) || entry.title.toLowerCase().includes(q)) {
        matches.set(entry.url, { title: entry.title || entry.url, url: entry.url });
      }
    }
    for (const bm of bookmarks) {
      if (bm.url.toLowerCase().includes(q) || bm.title.toLowerCase().includes(q)) {
        matches.set(bm.url, { title: bm.title, url: bm.url });
      }
    }
    return Array.from(matches.values()).slice(0, 8);
  }, [query, historyEntries, bookmarks]);
}
