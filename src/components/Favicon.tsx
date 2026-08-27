import { useState, useMemo, useEffect } from "react";
import { Globe, RefreshCw, Settings2, Terminal, Loader2 } from "lucide-react";
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

export function Favicon({
  tab,
  url,
  isLoading,
  size = 14,
}: {
  tab?: Tab;
  url?: string;
  isLoading?: boolean;
  size?: number;
}) {
  const targetUrl = url || tab?.url || "";
  const hostname = useMemo(() => (targetUrl ? getHostname(targetUrl) : null), [targetUrl]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  const candidates = useMemo(() => (hostname ? faviconCandidates(hostname) : []), [hostname]);
  const key = hostname || targetUrl;

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [key]);

  if (isLoading) {
    return <Loader2 size={size} className="tab-favicon tab-loading-spin" />;
  }
  if (tab?.kind === "home") {
    return <Globe size={size} className="tab-favicon globe" />;
  }
  if (tab?.kind === "updates") {
    return <RefreshCw size={size} className="tab-favicon generic" />;
  }
  if (tab?.kind === "console") {
    return <Terminal size={size} className="tab-favicon generic" />;
  }
  if (tab?.kind === "settings") {
    return <Settings2 size={size} className="tab-favicon generic" />;
  }

  if (!hostname || candidates.length === 0 || failed) {
    return <Globe size={size} className="tab-favicon generic" />;
  }

  const src = candidates[Math.min(idx, candidates.length - 1)];

  return (
    <img
      key={`${key}-${idx}`}
      src={src}
      alt=""
      width={size}
      height={size}
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
