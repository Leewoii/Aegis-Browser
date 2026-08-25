import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      // Cargo locks build artifacts while recompiling; watching them crashes Vite.
      ignored: ["**/src-tauri/target/**", "**/dist/**", "**/node_modules/**"],
    },
  },
  build: {
    target: "esnext",
    sourcemap: false,
  },
  clearScreen: false,
});
