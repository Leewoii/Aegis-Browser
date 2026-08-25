import { Mic, ScanSearch } from "lucide-react";
import { AiEmblem } from "./AiEmblem";
import type { Settings } from "../types";

interface HomeScreenProps {
  settings: Settings;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onScan: () => void;
  onVoice: () => void;
  isListening: boolean;
}

export function HomeScreen({
  settings,
  query,
  onQueryChange,
  onSubmit,
  onScan,
  onVoice,
  isListening,
}: HomeScreenProps) {
  return (
    <section className="home-screen">
      <div className="home-emblem-wrapper">
        <div className="home-emblem-glow" />
        <AiEmblem size={68} />
      </div>

      <p className="home-kicker">Happy to see you, {settings.homeGreeting}</p>
      <h1 className="home-title">How can I help you?</h1>

      <div className="search-card">
        {query.length === 0 && <span className="search-caret" aria-hidden="true" />}
        <input
          id="home-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit(query);
            }
          }}
          placeholder="Search now"
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <button className="search-scan-btn no-drag" type="button" onClick={onScan} aria-label="Scan QR or image" title="Scan QR code">
          <ScanSearch size={18} strokeWidth={1.7} />
        </button>
        <button
          className={`search-mic-btn no-drag ${isListening ? "listening" : ""}`}
          type="button"
          onClick={onVoice}
          aria-label="Voice search"
          title="Voice search"
        >
          <Mic size={17} strokeWidth={2.2} />
        </button>
      </div>
    </section>
  );
}
