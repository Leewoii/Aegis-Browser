import { useState, useMemo, useEffect } from "react";
import { Globe, RefreshCw, Terminal, Loader2 } from "lucide-react";
import type { Tab } from "../types";

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function faviconCandidates(hostname: string): string[] {
  const h = hostname.toLowerCase();
  return [
    `https://${h}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=32`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(h)}.ico`,
  ];
}

export function Favicon({ tab, isLoading }: { tab: Tab; isLoading?: boolean }) {
  const hostname = useMemo(() => (tab.url ? getHostname(tab.url) : null), [tab.url]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  const candidates = useMemo(() => (hostname ? faviconCandidates(hostname) : []), [hostname]);
  const key = hostname || tab.url;

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [key]);

  if (isLoading) {
    return <Loader2 size={14} className="tab-favicon tab-loading-spin" />;
  }
  if (tab.kind === "home") {
    return <Globe size={14} className="tab-favicon globe" />;
  }
  if (tab.kind === "updates") {
    return <RefreshCw size={14} className="tab-favicon generic" />;
  }
  if (tab.kind === "console") {
    return <Terminal size={14} className="tab-favicon generic" />;
  }

  if (!hostname || candidates.length === 0 || failed) {
    return <Globe size={14} className="tab-favicon generic" />;
  }

  const src = candidates[Math.min(idx, candidates.length - 1)];

  return (
    <img
      key={`${key}-${idx}`}
      src={src}
      alt=""
      width={14}
      height={14}
      className="tab-favicon tab-favicon-img"
      style={{ borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
      referrerPolicy="no-referrer"
      onError={() => {
        if (idx + 1 < candidates.length) {
          setIdx((v) => v + 1);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
