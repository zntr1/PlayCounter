import { dosboxAdapter } from "./dosbox";
import type { EmulatorAdapter } from "./types";

const adapters = new Map<string, EmulatorAdapter>([
  [dosboxAdapter.id, dosboxAdapter],
]);

export function adapterFor(emulatorId?: string | null) {
  return emulatorId ? (adapters.get(emulatorId.toLowerCase()) ?? null) : null;
}
