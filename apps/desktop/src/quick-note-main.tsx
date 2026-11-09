import "./disableBrowserContextMenu";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  CounterBoxAction,
  CounterBoxPayload,
  CounterBoxState,
} from "./counterBox";
import type { QuickAddPayload, QuickAddReply } from "./quickAdd";
import type { QuickNotePayload } from "./quickNote";
import "./styles.css";
import { applyTheme } from "./theme";
import { CounterBoxWindow } from "./ui/CounterBoxWindow";
import { QuickAddWindow } from "./ui/QuickAddWindow";
import { QuickNoteWindow } from "./ui/QuickNoteWindow";
import { ScreenshotCaptionWindow } from "./ui/ScreenshotCaptionWindow";

/** quick_note.rs QUICK_ADD_REPLY_EVENT: the main window's answers. */
const QUICK_ADD_REPLY_EVENT = "playcounter:quick-add-reply";
/** quick_note.rs COUNTER_BOX_UPDATE_EVENT: what the counter box shows now. */
const COUNTER_BOX_UPDATE_EVENT = "playcounter:counter-box-update";

type BoxPayload = QuickNotePayload | QuickAddPayload | CounterBoxPayload;

const isQuickAdd = (payload: BoxPayload): payload is QuickAddPayload =>
  "quickAdd" in payload && payload.quickAdd === true;

const isCounterBox = (payload: BoxPayload): payload is CounterBoxPayload =>
  "counterBox" in payload && Boolean(payload.counterBox);

const logged = (what: string) => (error: unknown) =>
  console.error(`quick add ${what} failed`, error);

function QuickNoteRoot() {
  const [payload, setPayload] = useState<BoxPayload | null>(null);

  useEffect(() => {
    invoke<BoxPayload | null>("quick_note_ready")
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
  const close = (note: string | null, restoreFocus: boolean) =>
    void invoke("quick_note_close", { note, restoreFocus }).catch((error) =>
      console.error("quick note failed to close", error),
    );
  // The same window searches a game to add when the quick add key opened it.
  if (isQuickAdd(payload))
    return (
      <QuickAddWindow
        payload={payload}
        onSearch={(query) =>
          void invoke("quick_add_search", { query }).catch(logged("search"))
        }
        onPick={(igdbId) =>
          void invoke("quick_add_pick", { igdbId }).catch(logged("pick"))
        }
        onFit={(height) =>
          void invoke("quick_add_fit", { height }).catch(logged("fit"))
        }
        onClose={(restoreFocus) => close(null, restoreFocus)}
        subscribe={(listener) => {
          const unlisten = listen<QuickAddReply>(
            QUICK_ADD_REPLY_EVENT,
            ({ payload: reply }) => listener(reply),
          );
          return () => void unlisten.then((stop) => stop());
        }}
      />
    );
  // The same window counts with the running game's counters.
  if (isCounterBox(payload))
    return (
      <CounterBoxWindow
        payload={payload}
        onAction={(action: CounterBoxAction) =>
          void invoke("counter_box_action", { action }).catch(
            logged("counter box action"),
          )
        }
        onFit={(height) =>
          void invoke("quick_add_fit", { height }).catch(logged("fit"))
        }
        onClose={(restoreFocus) => close(null, restoreFocus)}
        subscribe={(listener) => {
          const unlisten = listen<CounterBoxState>(
            COUNTER_BOX_UPDATE_EVENT,
            ({ payload: next }) => listener(next),
          );
          return () => void unlisten.then((stop) => stop());
        }}
      />
    );
  // The same window writes a screenshot's caption when one is set.
  if (payload.caption)
    return (
      <ScreenshotCaptionWindow
        payload={{ ...payload, caption: payload.caption }}
        onClose={close}
      />
    );
  return <QuickNoteWindow payload={payload} onClose={close} />;
}

createRoot(document.getElementById("quick-note-root")!).render(
  <QuickNoteRoot />,
);
