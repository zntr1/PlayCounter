import { useSyncExternalStore } from "react";

// Which pad sent the last controller input, so button hints show matching art.
// A PlayStation pad passed through Steam, DS4Windows or DSX arrives as "xbox".
export type ControllerKind = "xbox" | "ps5" | "ps4";

let currentKind: ControllerKind = "xbox";
const listeners = new Set<() => void>();

export function getControllerKind() {
  return currentKind;
}

export function setControllerKind(kind: ControllerKind) {
  if (kind === currentKind) return;
  currentKind = kind;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useControllerKind() {
  return useSyncExternalStore(subscribe, getControllerKind, getControllerKind);
}
