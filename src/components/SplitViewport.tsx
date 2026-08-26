import { useRef, useCallback, forwardRef } from "react";
import type { SplitViewState } from "../types";
import type { ContextMenuData } from "./ContextMenu";

interface SplitViewportProps {
  splitState: SplitViewState;
  leftRef: React.RefObject<HTMLDivElement | null>;
  rightRef: React.RefObject<HTMLDivElement | null>;
  onRatioChange: (ratio: number) => void;
  onActiveSideChange: (side: "left" | "right") => void;
  onOpenContextMenu?: (data: ContextMenuData) => void;
}

export const SplitViewport = forwardRef<HTMLDivElement, SplitViewportProps>(
  function SplitViewport(
    {
      splitState,
      leftRef,
      rightRef,
      onRatioChange,
      onActiveSideChange,
      onOpenContextMenu,
    },
    _ref
  ) {
    const { ratio, activeSide } = splitState;

    const isDividerDragging = useRef(false);
    const containerRef      = useRef<HTMLDivElement | null>(null);

    const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      isDividerDragging.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }, []);

    const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDividerDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width));
      onRatioChange(newRatio);
    }, [onRatioChange]);

    const handleDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      isDividerDragging.current = false;
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    }, []);

    const handleDividerDblClick = useCallback(() => {
      onRatioChange(0.5);
    }, [onRatioChange]);

    const handleDividerContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenContextMenu?.({
        type: "split-divider",
        x: e.clientX,
        y: e.clientY,
      });
    }, [onOpenContextMenu]);

    return (
      <div className="split-viewport" ref={containerRef}>
        {/* Left pane webview slot */}
        <div
          className={`split-pane split-pane-left ${activeSide === "left" ? "split-pane-active" : ""}`}
          style={{ width: `calc(${ratio * 100}% - 3px)` }}
          onPointerDown={() => onActiveSideChange("left")}
        >
          <div
            className="split-pane-content"
            ref={leftRef as React.RefObject<HTMLDivElement>}
          />
        </div>

        {/* Resizable divider */}
        <div
          className="split-divider"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onDoubleClick={handleDividerDblClick}
          onContextMenu={handleDividerContextMenu}
          title="Drag to resize · Double-click to reset 50/50 · Right-click for options"
        >
          <div className="split-divider-handle" />
        </div>

        {/* Right pane webview slot */}
        <div
          className={`split-pane split-pane-right ${activeSide === "right" ? "split-pane-active" : ""}`}
          style={{ width: `calc(${(1 - ratio) * 100}% - 3px)` }}
          onPointerDown={() => onActiveSideChange("right")}
        >
          <div
            className="split-pane-content"
            ref={rightRef as React.RefObject<HTMLDivElement>}
          />
        </div>
      </div>
    );
  }
);
