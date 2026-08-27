import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, Clock3, Globe, Mic, ScanSearch, Search } from "lucide-react";
import type { HistoryEntry, Bookmark as BookmarkEntry } from "../types";
import { normalizeUrl, titleFromUrl } from "../utils/browser";

export interface Suggestion {
  title: string;
  url: string;
  displayUrl: string;
  sourceLabel: string;
  detail: string;
}

export function useSuggestions(query: string, history: HistoryEntry[], bookmarks: BookmarkEntry[]): Suggestion[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    type SuggestionSource = "bookmark" | "history";
    type SuggestionAggregate = {
      url: string;
      title: string;
      displayUrl: string;
      sourceSet: Set<SuggestionSource>;
      visitedAt?: number;
      createdAt?: number;
      visitCount?: number;
    };

    const toDisplayUrl = (value: string): string => {
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.replace(/^www\./, "");
        const path = parsed.pathname === "/" ? "" : parsed.pathname;
        const tail = `${path}${parsed.search}${parsed.hash}`;
        return `${host}${tail}` || value;
      } catch {
        return value;
      }
    };

    const scoreTitle = (value: string): number => {
      const lower = value.toLowerCase();
      if (!lower || lower === "new tab") return 0;
      return Math.min(100, lower.length);
    };

    const aggregates = new Map<string, SuggestionAggregate>();

    const ensureAggregate = (url: string): SuggestionAggregate => {
      const key = normalizeUrl(url);
      const existing = aggregates.get(key);
      if (existing) return existing;
      const created: SuggestionAggregate = {
        url,
        title: titleFromUrl(url),
        displayUrl: toDisplayUrl(url),
        sourceSet: new Set(),
      };
      aggregates.set(key, created);
      return created;
    };

    const matches = (title: string, url: string): boolean => {
      const haystackTitle = title.toLowerCase();
      const haystackUrl = url.toLowerCase();
      return haystackTitle.includes(q) || haystackUrl.includes(q);
    };

    for (const item of bookmarks || []) {
      if (!matches(item.title, item.url)) continue;
      const aggregate = ensureAggregate(item.url);
      aggregate.sourceSet.add("bookmark");
      aggregate.createdAt = Math.max(aggregate.createdAt ?? 0, item.createdAt ?? 0) || aggregate.createdAt;
      if (scoreTitle(item.title) > scoreTitle(aggregate.title)) {
        aggregate.title = item.title;
      }
    }

    for (const item of history || []) {
      if (!matches(item.title, item.url)) continue;
      const aggregate = ensureAggregate(item.url);
      aggregate.sourceSet.add("history");
      aggregate.visitedAt = Math.max(aggregate.visitedAt ?? 0, item.visitedAt ?? 0) || aggregate.visitedAt;
      aggregate.visitCount = (aggregate.visitCount ?? 0) + 1;
      if (scoreTitle(item.title) > scoreTitle(aggregate.title)) {
        aggregate.title = item.title;
      }
    }

    const historyRank = (item: SuggestionAggregate): number => item.visitedAt ?? 0;
    const bookmarkRank = (item: SuggestionAggregate): number => item.createdAt ?? 0;

    return [...aggregates.values()]
      .sort((a, b) => {
        const aScore = Math.max(historyRank(a), bookmarkRank(a));
        const bScore = Math.max(historyRank(b), bookmarkRank(b));
        if (bScore !== aScore) return bScore - aScore;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 6)
      .map((item) => {
        const sources = [...item.sourceSet];
        const sourceLabel =
          sources.length === 2 ? "Bookmark + History" : sources[0] === "bookmark" ? "Bookmark" : "History";
        const detailParts: string[] = [];
        if (item.visitCount && item.visitCount > 1) detailParts.push(`${item.visitCount} visits`);
        if (item.visitedAt) {
          const minutes = Math.max(1, Math.round((Date.now() - item.visitedAt) / 60000));
          detailParts.push(minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`);
        } else if (item.createdAt) {
          const minutes = Math.max(1, Math.round((Date.now() - item.createdAt) / 60000));
          detailParts.push(minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`);
        }
        return {
          title: item.title,
          url: item.url,
          displayUrl: item.displayUrl,
          sourceLabel,
          detail: detailParts.join(" · "),
        };
      });
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
              <div className="suggestion-main">
                <span className="suggestion-title">{s.title}</span>
                <span className="suggestion-meta">
                  <span className="suggestion-source">
                    {s.sourceLabel === "Bookmark" ? <BookmarkIcon size={10} /> : <Clock3 size={10} />}
                    <span>{s.sourceLabel}</span>
                  </span>
                  {s.detail && <span className="suggestion-detail">{s.detail}</span>}
                </span>
              </div>
              <span className="suggestion-url">{s.displayUrl}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
