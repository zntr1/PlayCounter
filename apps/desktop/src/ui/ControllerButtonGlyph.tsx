// Unreal "Input Prompts Pack", style Alt with coloured letters.
import xboxAUrl from "../../../../assets/xbox/T_X_A_Color_Alt.png";
import xboxBUrl from "../../../../assets/xbox/T_X_B_Color_Alt.png";
import xboxDpadUrl from "../../../../assets/xbox/T_X_Dpad_Alt.png";
import xboxMenuUrl from "../../../../assets/xbox/T_X_X_Alt.png";
import xboxRbUrl from "../../../../assets/xbox/T_X_RB_Alt.png";
import xboxRightStickUrl from "../../../../assets/xbox/T_X_R_Alt.png";
import xboxViewUrl from "../../../../assets/xbox/T_X_Share_Alt.png";
import xboxXUrl from "../../../../assets/xbox/T_X_X_Color_Alt.png";
import xboxYUrl from "../../../../assets/xbox/T_X_Y_Color_Alt.png";
import xboxLbUrl from "../../../../assets/xbox/T_X_LB_Alt.png";
import ps5CrossUrl from "../../../../assets/playstation/T_P5_Cross_Color_Alt.png";
import ps5CircleUrl from "../../../../assets/playstation/T_P5_Circle_Color_Alt.png";
import ps5DpadUrl from "../../../../assets/playstation/T_P5_Dpad_Alt.png";
import ps5OptionsUrl from "../../../../assets/playstation/T_P5_Options_Alt.png";
import ps5R1Url from "../../../../assets/playstation/T_P5_R1_Alt.png";
import ps5RightStickUrl from "../../../../assets/playstation/T_P5_R_Alt.png";
import ps5CreateUrl from "../../../../assets/playstation/T_P5_Share_Alt.png";
import ps5SquareUrl from "../../../../assets/playstation/T_P5_Square_Color_Alt.png";
import ps5TriangleUrl from "../../../../assets/playstation/T_P5_Triangle_Color_Alt.png";
import ps5L1Url from "../../../../assets/playstation/T_P5_L1_Alt.png";
import ps4CrossUrl from "../../../../assets/playstation/T_P4_Cross_Color_Alt.png";
import ps4CircleUrl from "../../../../assets/playstation/T_P4_Circle_Color_Alt.png";
import ps4DpadUrl from "../../../../assets/playstation/T_P4_Dpad_Alt.png";
import ps4OptionsUrl from "../../../../assets/playstation/T_P4_Options_Alt.png";
import ps4R1Url from "../../../../assets/playstation/T_P4_R1_Alt.png";
import ps4RightStickUrl from "../../../../assets/playstation/T_P4_R_Alt.png";
import ps4ShareUrl from "../../../../assets/playstation/T_P4_Share_Alt.png";
import ps4SquareUrl from "../../../../assets/playstation/T_P4_Square_Color_Alt.png";
import ps4TriangleUrl from "../../../../assets/playstation/T_P4_Triangle_Color_Alt.png";
import ps4L1Url from "../../../../assets/playstation/T_P4_L1_Alt.png";
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

// The round buttons fill the middle 75% of their square (12.5% empty on
// each side, see .details-key-hint in styles.css); the shoulder buttons its
// full width.
const basePx: Record<"small" | "normal", number> = {
  small: 28,
  normal: 37,
};

export function ControllerButtonGlyph({
  button,
  size = "normal",
}: {
  button: ControllerControl;
  size?: "small" | "normal";
}) {
  const kind = useControllerKind();
  const px = basePx[size];

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
