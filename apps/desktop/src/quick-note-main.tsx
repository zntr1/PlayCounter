import "./disableBrowserContextMenu";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { QuickNotePayload } from "./quickNote";
import "./styles.css";
import { applyTheme } from "./theme";
import { QuickNoteWindow } from "./ui/QuickNoteWindow";

function QuickNoteRoot() {
  const [payload, setPayload] = useState<QuickNotePayload | null>(null);

  useEffect(() => {
    invoke<QuickNotePayload | null>("quick_note_ready")
      .then((next) => {
        if (!next) return;
        // Chinese text only gets Chinese glyph shapes with the right lang.
        if (next.locale) document.documentElement.lang = next.locale;
        applyTheme(next.theme, next.accentColor);
        setPayload(next);
      })
      .catch((error) => console.error("quick note failed to load", error));
  }, []);

  if (!payload) return null;
  return (
    <QuickNoteWindow
      payload={payload}
      onClose={(note, restoreFocus) =>
        void invoke("quick_note_close", { note, restoreFocus }).catch((error) =>
          console.error("quick note failed to close", error),
        )
      }
    />
  );
}

createRoot(document.getElementById("quick-note-root")!).render(
  <QuickNoteRoot />,
);
