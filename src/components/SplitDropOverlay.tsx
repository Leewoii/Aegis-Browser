import type { Tab } from "../types";

export type SplitSide = "left" | "right" | null;

interface SplitDropOverlayProps {
  side: SplitSide;
  draggedTab: Tab | null;
}

export function SplitDropOverlay({ side, draggedTab }: SplitDropOverlayProps) {
  if (!side || !draggedTab) return null;

  return (
    <div className={`split-drop-overlay split-drop-${side}`}>
      {/* Edge hint strip — always shown when near the edge */}
      <div className="split-drop-edge-strip" />

      {/* Full content panel */}
      <div className="split-drop-content">
        <div className="split-drop-icon" aria-hidden="true">
          {side === "right" ? (
            <svg width="52" height="42" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="22" height="40" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.35" />
              <rect x="29" y="1" width="22" height="40" rx="3" stroke="currentColor" strokeWidth="2.5" fill="rgba(255,255,255,0.10)" />
              <line x1="26" y1="4" x2="26" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            </svg>
          ) : (
            <svg width="52" height="42" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="22" height="40" rx="3" stroke="currentColor" strokeWidth="2.5" fill="rgba(255,255,255,0.10)" />
              <rect x="29" y="1" width="22" height="40" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.35" />
              <line x1="26" y1="4" x2="26" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            </svg>
          )}
        </div>
        <p className="split-drop-title">Split like the custody agreement.</p>
        <p className="split-drop-subtitle">Drop tab here to split screen</p>
      </div>
    </div>
  );
}
