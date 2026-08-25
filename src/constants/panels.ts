export const WEB_APP_PANELS: Record<string, string> = {
  messenger: "https://www.messenger.com",
  whatsapp: "https://web.whatsapp.com",
  chatgpt: "https://chatgpt.com",
  twitch: "https://www.twitch.tv",
  spotify: "https://open.spotify.com",
};

export const HOME_TAB_ID = "home";

export const DEFAULT_SETTINGS = {
  theme: "dark",
  sidebarPosition: "left",
  searchEngine: "duckduckgo",
  homeGreeting: "Welcome back",
} as const;

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
