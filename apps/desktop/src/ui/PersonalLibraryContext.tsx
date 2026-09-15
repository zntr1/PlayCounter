import { createContext, useContext } from "react";
import { useStore, type StoreApi } from "zustand";
import type { PersonalLibraryState } from "../personalLibraryStore";
import { useAppStore } from "../store";

export const PersonalLibraryContext =
  createContext<StoreApi<PersonalLibraryState> | null>(null);

export function usePersonalLibraryApi() {
  return useContext(PersonalLibraryContext) ?? useAppStore;
}

export function usePersonalLibraryState<T>(
  selector: (state: PersonalLibraryState) => T,
) {
  return useStore(usePersonalLibraryApi(), selector);
}

export function useLibraryPractice() {
  return useContext(PersonalLibraryContext) !== null;
}
