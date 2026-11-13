import { useMemo } from "react";
import { hiddenGameKeys, type ShelfHidePlace } from "../personalLibrary";
import { personalGameIdentity } from "../store";
import { usePersonalLibraryState } from "./PersonalLibraryContext";

/** Identity keys of the games a shelf hides in this place, comparable with
 *  getSessionGameKey and the game ladders' scopes. */
export function useHiddenGameKeys(place: ShelfHidePlace) {
  const journals = usePersonalLibraryState((s) => s.gameJournals);
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const gameMetadata = usePersonalLibraryState((s) => s.gameMetadata);
  const exeCache = usePersonalLibraryState((s) => s.exeCache);
  const libraryImports = usePersonalLibraryState((s) => s.libraryImports);
  return useMemo(
    () =>
      hiddenGameKeys(
        journals,
        shelves,
        personalGameIdentity({ gameMetadata, exeCache, libraryImports }),
        place,
      ),
    [journals, shelves, gameMetadata, exeCache, libraryImports, place],
  );
}
