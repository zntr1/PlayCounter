import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { applyTheme, normalizeAccentColor } from "./theme";
import "./styles.css";

// Apply the persisted theme before the first paint so the app never flashes
// the wrong theme while the store hydrates.
const persistedAppearance = readPersistedAppearance();
applyTheme(persistedAppearance.theme, persistedAppearance.accentColor);

function readPersistedAppearance() {
  try {
    const raw = localStorage.getItem("playcounter:v1");
    const parsed = raw
      ? (JSON.parse(raw) as {
          settings?: { theme?: unknown; accentColor?: unknown };
        })
      : null;
    return {
      theme: parsed?.settings?.theme === "light" ? "light" : "dark",
      accentColor: normalizeAccentColor(parsed?.settings?.accentColor),
    } as const;
  } catch {
    return { theme: "dark", accentColor: null } as const;
  }
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
