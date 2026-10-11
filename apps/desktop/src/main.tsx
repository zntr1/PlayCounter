import "./disableBrowserContextMenu";
import "./pauseIdleAnimations";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { applyTheme, normalizeAccentColor } from "./theme";
import { applyLanguage } from "./i18n";
import "./styles.css";

// Apply the persisted theme and language before the first paint so the app
// never flashes the wrong theme or language while the store hydrates.
const persistedAppearance = readPersistedAppearance();
applyTheme(persistedAppearance.theme, persistedAppearance.accentColor);
applyLanguage(persistedAppearance.language);

function readPersistedAppearance() {
  try {
    const raw = localStorage.getItem("playcounter:v1");
    const parsed = raw
      ? (JSON.parse(raw) as {
          settings?: {
            theme?: unknown;
            accentColor?: unknown;
            language?: unknown;
          };
        })
      : null;
    const language = parsed?.settings?.language;
    return {
      theme: parsed?.settings?.theme === "light" ? "light" : "dark",
      accentColor: normalizeAccentColor(parsed?.settings?.accentColor),
      language: typeof language === "string" ? language : undefined,
    } as const;
  } catch {
    return { theme: "dark", accentColor: null, language: undefined } as const;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Keep a fallback reveal after React paints. The small brand bootstrap normally
// reveals the window earlier, once the startup artwork has painted; the native
// command is idempotent and keeps autostart launches in the tray.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("main_window_ready"))
      .catch(() => {});
  });
});
