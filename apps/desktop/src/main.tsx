import "./disableBrowserContextMenu";
import "./pauseIdleAnimations";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { applyTheme, normalizeAccentColor } from "./theme";
import { applyFormats, applyLanguage, setSystemDatePattern } from "./i18n";
import "./styles.css";

// Apply the persisted theme, language and formats before the first paint so
// the app never flashes the wrong theme or language while the store hydrates.
const persistedAppearance = readPersistedAppearance();
applyTheme(persistedAppearance.theme, persistedAppearance.accentColor);
applyFormats(persistedAppearance.formatRegion, persistedAppearance.clockFormat);
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
            formatRegion?: unknown;
            clockFormat?: unknown;
          };
        })
      : null;
    const language = parsed?.settings?.language;
    const region = parsed?.settings?.formatRegion;
    const clock = parsed?.settings?.clockFormat;
    return {
      theme: parsed?.settings?.theme === "light" ? "light" : "dark",
      accentColor: normalizeAccentColor(parsed?.settings?.accentColor),
      language: typeof language === "string" ? language : undefined,
      formatRegion: typeof region === "string" ? region : null,
      clockFormat: clock === "24h" || clock === "12h" ? clock : "auto",
    } as const;
  } catch {
    return {
      theme: "dark",
      accentColor: null,
      language: undefined,
      formatRegion: null,
      clockFormat: "auto",
    } as const;
  }
}

// Windows' own date format, for Automatic dates in numbers. Asked before the
// first paint so no date changes its look; half a second at most.
async function readSystemDatePattern() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const pattern = await Promise.race([
      invoke<string | null>("system_date_pattern"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    setSystemDatePattern(pattern);
  } catch {
    // The computer's country decides then.
  }
}

void readSystemDatePattern().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

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
