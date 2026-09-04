import aButtonUrl from "../../../../assets/xbox/XboxSeriesX_A.png";
import bButtonUrl from "../../../../assets/xbox/XboxSeriesX_B.png";
import dpadUrl from "../../../../assets/xbox/XboxSeriesX_Dpad.png";
import rbUrl from "../../../../assets/xbox/XboxSeriesX_RB.png";
import rightStickUrl from "../../../../assets/xbox/XboxSeriesX_Right_Stick_Click.png";
import viewUrl from "../../../../assets/xbox/XboxSeriesX_View.png";

export type XboxControl = "A" | "B" | "DPAD" | "RIGHT_STICK" | "VIEW" | "RB";

const glyphUrls: Record<XboxControl, string> = {
  A: aButtonUrl,
  B: bButtonUrl,
  DPAD: dpadUrl,
  RIGHT_STICK: rightStickUrl,
  VIEW: viewUrl,
  RB: rbUrl,
};

// The RB artwork is letterboxed inside its square canvas, so it needs a bump to
// read at the same visual weight as the round face buttons.
const glyphScale: Partial<Record<XboxControl, number>> = {
  RB: 1.4,
};

const basePx: Record<"small" | "normal", number> = {
  small: 26,
  normal: 34,
};

export function XboxButtonGlyph({
  button,
  size = "normal",
}: {
  button: XboxControl;
  size?: "small" | "normal";
}) {
  const px = Math.round(basePx[size] * (glyphScale[button] ?? 1));

  return (
    <img
      src={glyphUrls[button]}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={px}
      height={px}
      style={{ width: px, height: px }}
      className="inline-block shrink-0 select-none object-contain drop-shadow-[0_2px_3px_rgb(0_0_0/0.45)]"
    />
  );
}
