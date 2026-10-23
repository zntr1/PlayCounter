import type { EmulatorId } from "@playcounter/shared";
import azaharIconUrl from "../../../../assets/emulators/azahar/azahar.png";
import cemuIconUrl from "../../../../assets/emulators/cemu/cemu.png";
import dosboxIconUrl from "../../../../assets/emulators/dosbox/DOSBox_icon.png";
import dolphinIconUrl from "../../../../assets/emulators/dolphin/dolphin-emu.svg";
import duckstationIconUrl from "../../../../assets/emulators/duckstation/duckstation.png";
import edenIconUrl from "../../../../assets/emulators/eden/eden.png";
import melondsIconUrl from "../../../../assets/emulators/melonds/melonds.png";
import mgbaIconUrl from "../../../../assets/emulators/mgba/mgba.png";
import pcsx2IconUrl from "../../../../assets/emulators/pcsx2/pcsx2.png";
import ppssppIconUrl from "../../../../assets/emulators/ppsspp/ppsspp.png";
import rpcs3IconUrl from "../../../../assets/emulators/rpcs3/rpcs3.svg";
import ryujinxIconUrl from "../../../../assets/emulators/ryujinx/ryujinx.png";
import xeniaIconUrl from "../../../../assets/emulators/xenia/xenia.png";

export const emulatorAssetUrls: Readonly<Record<string, string>> = {
  dosbox: dosboxIconUrl,
  dolphin: dolphinIconUrl,
  pcsx2: pcsx2IconUrl,
  mgba: mgbaIconUrl,
  cemu: cemuIconUrl,
  rpcs3: rpcs3IconUrl,
  ppsspp: ppssppIconUrl,
  duckstation: duckstationIconUrl,
  ryujinx: ryujinxIconUrl,
  eden: edenIconUrl,
  azahar: azaharIconUrl,
  melonds: melondsIconUrl,
  xenia: xeniaIconUrl,
} satisfies Record<EmulatorId, string>;
