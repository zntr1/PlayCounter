import type { EmulatorId } from "@playcounter/shared";
import { cemuAdapter } from "./cemu";
import { dosboxAdapter } from "./dosbox";
import { dolphinAdapter } from "./dolphin";
import { duckstationAdapter } from "./duckstation";
import { edenAdapter } from "./eden";
import { mgbaAdapter } from "./mgba";
import { pcsx2Adapter } from "./pcsx2";
import { ppssppAdapter } from "./ppsspp";
import { rpcs3Adapter } from "./rpcs3";
import { ryujinxAdapter } from "./ryujinx";
import type { EmulatorAdapter } from "./types";
import { appLocale } from "../i18n";

// Every EmulatorId must have an adapter. The order is the sidebar, filter and
// copy order.
const adapters = {
  dosbox: dosboxAdapter,
  dolphin: dolphinAdapter,
  pcsx2: pcsx2Adapter,
  mgba: mgbaAdapter,
  cemu: cemuAdapter,
  rpcs3: rpcs3Adapter,
  ppsspp: ppssppAdapter,
  duckstation: duckstationAdapter,
  ryujinx: ryujinxAdapter,
  eden: edenAdapter,
} satisfies Record<EmulatorId, EmulatorAdapter>;

export const EMULATORS: readonly EmulatorAdapter[] = Object.values(adapters);

export const EMULATOR_IDS = EMULATORS.map((adapter) => adapter.id);

export function isEmulatorId(value: string): value is EmulatorId {
  return Object.hasOwn(adapters, value);
}

export function adapterFor(emulatorId: EmulatorId): EmulatorAdapter;
export function adapterFor(emulatorId?: string | null): EmulatorAdapter | null;
export function adapterFor(emulatorId?: string | null) {
  const id = emulatorId?.toLowerCase();
  return id && isEmulatorId(id) ? adapters[id] : null;
}

const EMULATOR_EXE_NAMES = new Set(
  EMULATORS.flatMap((adapter) => adapter.exeNames),
);

/** An emulator's own program, which is never a game itself. */
export function isEmulatorExe(exeName: string) {
  return EMULATOR_EXE_NAMES.has(exeName.toLowerCase());
}

/** "DOSBox, Dolphin, PCSX2, or mGBA" */
/** "Dolphin, PCSX2, DOSBox, or mGBA" in the app's language. */
export function emulatorLabelList(conjunction: "or" | "and") {
  return new Intl.ListFormat(appLocale(), {
    type: conjunction === "or" ? "disjunction" : "conjunction",
  }).format(EMULATORS.map((adapter) => adapter.label));
}
