import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, Mic, ScanSearch, Search } from "lucide-react";
import type { HistoryEntry, Bookmark } from "../types";

export interface Suggestion {
  title: string;
  url: string;
}

export function useSuggestions(query: string, history: HistoryEntry[], bookmarks: Bookmark[]): Suggestion[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const fromHistory: Suggestion[] = (history || [])
      .filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      .map((h) => ({ title: h.title, url: h.url }));
    const fromBookmarks: Suggestion[] = (bookmarks || [])
      .filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
      .map((b) => ({ title: b.title, url: b.url }));
    const merged = [...fromBookmarks, ...fromHistory];
    const seen = new Set<string>();
    return merged
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, 6);
  }, [query, history, bookmarks]);
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
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState(query || url || "");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync inputValue with url or query when tab/url changes and user is not actively typing
  useEffect(() => {
    if (!isFocused) {
      setInputValue(query || url || "");
    }
  }, [url, query, isFocused]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setIsFocused(false);
        setInputValue(url || "");
        onQueryChange("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [url, onQueryChange]);

  const visible = showSuggestions && suggestions.length > 0 && isFocused;

  function selectSuggestion(selected: string) {
    setShowSuggestions(false);
    setIsFocused(false);
    setInputValue(selected);
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
          setIsFocused(false);
          const finalVal = inputValue.trim() || url || "";
          inputRef.current?.blur();
          onSubmit(finalVal);
        }}
      >
        <Search size={15} className="omnibox-icon" />
        <input
          id="omnibox"
          ref={inputRef}
          value={inputValue}
          onChange={(event) => {
            const val = event.target.value;
            setInputValue(val);
            onQueryChange(val);
            if (val.trim()) setShowSuggestions(true);
          }}
          onFocus={(e) => {
            setIsFocused(true);
            // Select entire text on focus so user can immediately Copy (Ctrl+C) or type over it
            e.currentTarget.select();
            if (inputValue.trim() && inputValue !== url) setShowSuggestions(true);
          }}
          onBlur={() => {
            // Delay slightly so suggestion clicks still register
            setTimeout(() => {
              if (document.activeElement !== inputRef.current) {
                setIsFocused(false);
                if (!inputValue.trim()) {
                  setInputValue(url || "");
                }
              }
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowSuggestions(false);
              setIsFocused(false);
              setInputValue(url || "");
              onQueryChange("");
              inputRef.current?.blur();
            }
          }}
          placeholder="Search or enter address"
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
