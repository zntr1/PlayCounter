import { dosboxAdapter } from "./dosbox";
import { dolphinAdapter } from "./dolphin";
import { pcsx2Adapter } from "./pcsx2";
import type { EmulatorAdapter } from "./types";

const adapters = new Map<string, EmulatorAdapter>([
  [dosboxAdapter.id, dosboxAdapter],
  [dolphinAdapter.id, dolphinAdapter],
  [pcsx2Adapter.id, pcsx2Adapter],
]);

export function adapterFor(emulatorId?: string | null) {
  return emulatorId ? (adapters.get(emulatorId.toLowerCase()) ?? null) : null;
}
