import xboxAUrl from "../../../../assets/xbox/XboxSeriesX_A.png";
import xboxBUrl from "../../../../assets/xbox/XboxSeriesX_B.png";
import xboxDpadUrl from "../../../../assets/xbox/XboxSeriesX_Dpad.png";
import xboxMenuUrl from "../../../../assets/xbox/XboxSeriesX_Menu.png";
import xboxRbUrl from "../../../../assets/xbox/XboxSeriesX_RB.png";
import xboxRightStickUrl from "../../../../assets/xbox/XboxSeriesX_Right_Stick_Click.png";
import xboxViewUrl from "../../../../assets/xbox/XboxSeriesX_View.png";
import xboxXUrl from "../../../../assets/xbox/XboxSeriesX_X.png";
import xboxYUrl from "../../../../assets/xbox/XboxSeriesX_Y.png";
import xboxLbUrl from "../../../../assets/xbox/XboxSeriesX_LB.png";
import ps5CrossUrl from "../../../../assets/playstation/PS5_Cross.png";
import ps5CircleUrl from "../../../../assets/playstation/PS5_Circle.png";
import ps5DpadUrl from "../../../../assets/playstation/PS5_Dpad.png";
import ps5OptionsUrl from "../../../../assets/playstation/PS5_Options.png";
import ps5R1Url from "../../../../assets/playstation/PS5_R1.png";
import ps5RightStickUrl from "../../../../assets/playstation/PS5_Right_Stick_Click.png";
import ps5CreateUrl from "../../../../assets/playstation/PS5_Share.png";
import ps5SquareUrl from "../../../../assets/playstation/PS5_Square.png";
import ps5TriangleUrl from "../../../../assets/playstation/PS5_Triangle.png";
import ps5L1Url from "../../../../assets/playstation/PS5_L1.png";
import ps4CrossUrl from "../../../../assets/playstation/PS4_Cross.png";
import ps4CircleUrl from "../../../../assets/playstation/PS4_Circle.png";
import ps4DpadUrl from "../../../../assets/playstation/PS4_Dpad.png";
import ps4OptionsUrl from "../../../../assets/playstation/PS4_Options.png";
import ps4R1Url from "../../../../assets/playstation/PS4_R1.png";
import ps4RightStickUrl from "../../../../assets/playstation/PS4_Right_Stick_Click.png";
import ps4ShareUrl from "../../../../assets/playstation/PS4_Share.png";
import ps4SquareUrl from "../../../../assets/playstation/PS4_Square.png";
import ps4TriangleUrl from "../../../../assets/playstation/PS4_Triangle.png";
import ps4L1Url from "../../../../assets/playstation/PS4_L1.png";
import { useControllerKind, type ControllerKind } from "../controllerKind";
import { getT } from "../i18n";

const t = getT("common");

// Button ids follow the Xbox layout. PlayStation pads show the button in the
// same place: Cross for A, Circle for B, Square for X, Triangle for Y,
// Create/Share for View, L1 for LB, R1 for RB, Options for Menu.
export type ControllerControl =
  | "A"
  | "B"
  | "X"
  | "Y"
  | "DPAD"
  | "RIGHT_STICK"
  | "VIEW"
  | "MENU"
  | "LB"
  | "RB";

const glyphUrls: Record<ControllerKind, Record<ControllerControl, string>> = {
  xbox: {
    A: xboxAUrl,
    B: xboxBUrl,
    X: xboxXUrl,
    Y: xboxYUrl,
    DPAD: xboxDpadUrl,
    RIGHT_STICK: xboxRightStickUrl,
    VIEW: xboxViewUrl,
    MENU: xboxMenuUrl,
    LB: xboxLbUrl,
    RB: xboxRbUrl,
  },
  ps5: {
    A: ps5CrossUrl,
    B: ps5CircleUrl,
    X: ps5SquareUrl,
    Y: ps5TriangleUrl,
    DPAD: ps5DpadUrl,
    RIGHT_STICK: ps5RightStickUrl,
    VIEW: ps5CreateUrl,
    MENU: ps5OptionsUrl,
    LB: ps5L1Url,
    RB: ps5R1Url,
  },
  ps4: {
    A: ps4CrossUrl,
    B: ps4CircleUrl,
    X: ps4SquareUrl,
    Y: ps4TriangleUrl,
    DPAD: ps4DpadUrl,
    RIGHT_STICK: ps4RightStickUrl,
    VIEW: ps4ShareUrl,
    MENU: ps4OptionsUrl,
    LB: ps4L1Url,
    RB: ps4R1Url,
  },
};

// A function, so the names follow the current language.
function buttonNames(): Record<
  ControllerKind,
  Record<ControllerControl, string>
> {
  return {
    xbox: {
      A: "A",
      B: "B",
      X: "X",
      Y: "Y",
      DPAD: t("D-pad"),
      RIGHT_STICK: t("Right stick"),
      VIEW: t("View"),
      MENU: t("Menu"),
      LB: t("Left bumper"),
      RB: t("Right bumper"),
    },
    ps5: {
      A: t("Cross"),
      B: t("Circle"),
      X: t("Square"),
      Y: t("Triangle"),
      DPAD: t("D-pad"),
      RIGHT_STICK: t("Right stick"),
      VIEW: t("Create"),
      MENU: t("Options"),
      LB: "L1",
      RB: "R1",
    },
    ps4: {
      A: t("Cross"),
      B: t("Circle"),
      X: t("Square"),
      Y: t("Triangle"),
      DPAD: t("D-pad"),
      RIGHT_STICK: t("Right stick"),
      VIEW: t("Share"),
      MENU: t("Options"),
      LB: "L1",
      RB: "R1",
    },
  };
}

export function controllerButtonName(
  kind: ControllerKind,
  button: ControllerControl,
) {
  return buttonNames()[kind][button];
}

// The shoulder button artwork is letterboxed inside its square canvas, so it
// needs a bump to read at the same visual weight as the round face buttons.
const glyphScale: Partial<Record<ControllerControl, number>> = {
  LB: 1.4,
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
