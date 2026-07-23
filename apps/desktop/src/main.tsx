import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { applyTheme } from "./store";
import "./styles.css";

// Apply the persisted theme before the first paint so the app never flashes
// the wrong theme while the store hydrates.
applyTheme(readPersistedTheme());

function readPersistedTheme() {
  try {
    const raw = localStorage.getItem("playcounter:v1");
    const parsed = raw
      ? (JSON.parse(raw) as { settings?: { theme?: unknown } })
      : null;
    return parsed?.settings?.theme === "light" ? "light" : "dark";
  } catch {
    return "dark";
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
