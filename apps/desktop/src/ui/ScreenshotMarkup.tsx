import type { ReactNode, RefObject } from "react";
import { markUpScreenshot, type Screenshot } from "../screenshots";
import { useAppStore } from "../store";
import { getT } from "../i18n";
import { MarkupTools, type MarkupTexts } from "./MarkupTools";

const t = getT("history");

/* Mark up in the screenshot viewer (docs/screenshot-markup-plan.md). The
   drawing is MarkupTools; this gives it the app's texts and saves through
   the app. */

/** Mark up's texts in the app's language, built when asked so a language
 *  switch shows. The box over the game gets them too (screenshotBox.ts). */
export function markupTexts(): MarkupTexts {
  return {
    Pen: t("Pen"),
    Arrow: t("Arrow"),
    Circle: t("Circle"),
    Number: t("Number"),
    Stickers: t("Stickers"),
    Red: t("Red"),
    Amber: t("Amber"),
    Green: t("Green"),
    White: t("White"),
    "This way": t("This way"),
    "Check later": t("Check later"),
    Danger: t("Danger"),
    Loot: t("Loot"),
    Boss: t("Boss"),
    Locked: t("Locked"),
    Key: t("Key"),
    "Picture to draw on": t("Picture to draw on"),
    "Mark up tools": t("Mark up tools"),
    Undo: t("Undo"),
    "Clear all": t("Clear all"),
    Cancel: t("Cancel"),
    "Save into picture": t("Save into picture"),
    "Discard your marks?": t("Discard your marks?"),
    "Keep drawing": t("Keep drawing"),
    Discard: t("Discard"),
    "The marks couldn't be saved.": t("The marks couldn't be saved."),
    "Saving draws the marks into the picture for good. The picture without them goes to the Recycle Bin.":
      t(
        "Saving draws the marks into the picture for good. The picture without them goes to the Recycle Bin.",
      ),
  };
}

export function ScreenshotMarkup({
  shot,
  image,
  width,
  onDone,
  caption,
}: {
  shot: Screenshot;
  /** The picture as the viewer shows it; the canvas lies over it. */
  image: RefObject<HTMLImageElement | null>;
  /** The picture's width as shown, so the tools line up with it. */
  width: number | null;
  onDone: () => void;
  /** The picture's caption line, under the tools. */
  caption?: ReactNode;
}) {
  return (
    <MarkupTools
      caption={caption}
      image={image}
      width={width}
      texts={markupTexts()}
      onDone={onDone}
      save={async (png) => {
        await markUpScreenshot(shot.path, png);
        useAppStore.getState().addToast({
          tone: "success",
          title: t("Saved into the picture"),
          detail: t("The picture without your marks is in the Recycle Bin."),
        });
      }}
    />
  );
}
