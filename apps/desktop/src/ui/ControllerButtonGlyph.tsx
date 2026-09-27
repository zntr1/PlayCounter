import xboxAUrl from "../../../../assets/xbox/XboxSeriesX_A.png";
import xboxBUrl from "../../../../assets/xbox/XboxSeriesX_B.png";
import xboxDpadUrl from "../../../../assets/xbox/XboxSeriesX_Dpad.png";
import xboxRbUrl from "../../../../assets/xbox/XboxSeriesX_RB.png";
import xboxRightStickUrl from "../../../../assets/xbox/XboxSeriesX_Right_Stick_Click.png";
import xboxViewUrl from "../../../../assets/xbox/XboxSeriesX_View.png";
import ps5CrossUrl from "../../../../assets/playstation/PS5_Cross.png";
import ps5CircleUrl from "../../../../assets/playstation/PS5_Circle.png";
import ps5DpadUrl from "../../../../assets/playstation/PS5_Dpad.png";
import ps5R1Url from "../../../../assets/playstation/PS5_R1.png";
import ps5RightStickUrl from "../../../../assets/playstation/PS5_Right_Stick_Click.png";
import ps5CreateUrl from "../../../../assets/playstation/PS5_Share.png";
import ps4CrossUrl from "../../../../assets/playstation/PS4_Cross.png";
import ps4CircleUrl from "../../../../assets/playstation/PS4_Circle.png";
import ps4DpadUrl from "../../../../assets/playstation/PS4_Dpad.png";
import ps4R1Url from "../../../../assets/playstation/PS4_R1.png";
import ps4RightStickUrl from "../../../../assets/playstation/PS4_Right_Stick_Click.png";
import ps4ShareUrl from "../../../../assets/playstation/PS4_Share.png";
import { useControllerKind, type ControllerKind } from "../controllerKind";

// Button ids follow the Xbox layout. PlayStation pads show the button in the
// same place: Cross for A, Circle for B, Create/Share for View, R1 for RB.
export type ControllerControl =
  | "A"
  | "B"
  | "DPAD"
  | "RIGHT_STICK"
  | "VIEW"
  | "RB";

const glyphUrls: Record<ControllerKind, Record<ControllerControl, string>> = {
  xbox: {
    A: xboxAUrl,
    B: xboxBUrl,
    DPAD: xboxDpadUrl,
    RIGHT_STICK: xboxRightStickUrl,
    VIEW: xboxViewUrl,
    RB: xboxRbUrl,
  },
  ps5: {
    A: ps5CrossUrl,
    B: ps5CircleUrl,
    DPAD: ps5DpadUrl,
    RIGHT_STICK: ps5RightStickUrl,
    VIEW: ps5CreateUrl,
    RB: ps5R1Url,
  },
  ps4: {
    A: ps4CrossUrl,
    B: ps4CircleUrl,
    DPAD: ps4DpadUrl,
    RIGHT_STICK: ps4RightStickUrl,
    VIEW: ps4ShareUrl,
    RB: ps4R1Url,
  },
};

const buttonNames: Record<ControllerKind, Record<ControllerControl, string>> = {
  xbox: {
    A: "A",
    B: "B",
    DPAD: "D-pad",
    RIGHT_STICK: "Right stick",
    VIEW: "View",
    RB: "Right bumper",
  },
  ps5: {
    A: "Cross",
    B: "Circle",
    DPAD: "D-pad",
    RIGHT_STICK: "Right stick",
    VIEW: "Create",
    RB: "R1",
  },
  ps4: {
    A: "Cross",
    B: "Circle",
    DPAD: "D-pad",
    RIGHT_STICK: "Right stick",
    VIEW: "Share",
    RB: "R1",
  },
};

export function controllerButtonName(
  kind: ControllerKind,
  button: ControllerControl,
) {
  return buttonNames[kind][button];
}

// The shoulder button artwork is letterboxed inside its square canvas, so it
// needs a bump to read at the same visual weight as the round face buttons.
const glyphScale: Partial<Record<ControllerControl, number>> = {
  RB: 1.4,
};

const basePx: Record<"small" | "normal", number> = {
  small: 26,
  normal: 34,
};

export function ControllerButtonGlyph({
  button,
  size = "normal",
}: {
  button: ControllerControl;
  size?: "small" | "normal";
}) {
  const kind = useControllerKind();
  const px = Math.round(basePx[size] * (glyphScale[button] ?? 1));

  return (
    <img
      src={glyphUrls[kind][button]}
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
