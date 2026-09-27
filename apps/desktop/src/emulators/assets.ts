import type { EmulatorId } from "@playcounter/shared";
import dosboxIconUrl from "../../../../assets/emulators/dosbox/DOSBox_icon.png";
import dolphinIconUrl from "../../../../assets/emulators/dolphin/dolphin-emu.svg";
import mgbaIconUrl from "../../../../assets/emulators/mgba/mgba.png";
import pcsx2IconUrl from "../../../../assets/emulators/pcsx2/pcsx2.png";

export const emulatorAssetUrls: Readonly<Record<string, string>> = {
  dosbox: dosboxIconUrl,
  dolphin: dolphinIconUrl,
  pcsx2: pcsx2IconUrl,
  mgba: mgbaIconUrl,
} satisfies Record<EmulatorId, string>;
