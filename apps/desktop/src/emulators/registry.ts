import { dosboxAdapter } from "./dosbox";
import { dolphinAdapter } from "./dolphin";
import type { EmulatorAdapter } from "./types";

const adapters = new Map<string, EmulatorAdapter>([
  [dosboxAdapter.id, dosboxAdapter],
  [dolphinAdapter.id, dolphinAdapter],
]);

export function adapterFor(emulatorId?: string | null) {
  return emulatorId ? (adapters.get(emulatorId.toLowerCase()) ?? null) : null;
}
