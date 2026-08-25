import { useEffect } from "react";

export interface ShortcutActions {
  focusOmnibox: () => void;
  newTab: () => void;
  closeTab: () => void;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
}

export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "l") {
        event.preventDefault();
        actions.focusOmnibox();
      }
      if (mod && key === "t") {
        event.preventDefault();
        actions.newTab();
      }
      if (mod && key === "w") {
        event.preventDefault();
        actions.closeTab();
      }
      if (mod && key === "r") {
        event.preventDefault();
        actions.reload();
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        actions.goBack();
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        actions.goForward();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
