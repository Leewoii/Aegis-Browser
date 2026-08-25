import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

void (async () => {
  try {
    await getCurrentWindow().setBackgroundColor("#00000000");
    await getCurrentWebview().setBackgroundColor("#00000000");
  } catch {
    // Ignore runtime background setup failures and fall back to config/CSS.
  }
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
