import { createContext, useContext, useMemo, type ReactNode } from "react";
import { searchLibraryGames } from "../../library/gameLookup";
import {
  browseGameFile,
  chooseImportAccount,
  chooseImportScope,
  importOneGame,
  importSelectedGames,
  lookUpPickedGame,
  pickGameFile,
  pickImportGame,
  replaceImportMatch,
  reviewRemainingGames,
  setGameSelected,
  setGamesSelected,
  setImportChoices,
  setReplacementChoices,
  showImportGame,
  showImportGroup,
  showImportList,
  showImportUpdates,
  skipImportGame,
  unskipImportGame,
} from "../../library/importSession";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type { ImportScope } from "../../library/importProfiles";
import type { ImportGroupKey } from "../../library/importGroups";
import type { LibraryImportEntry } from "../../library/types";
import { useAppStore, type GameMetadata } from "../../store";

/* Who the import screens work for. In the app that is the one real import
   (library/importSession) and the player's library. The guide "Import a
   launcher library" shows the same screens on sample games: it brings its
   own actions and its own "My Games", so nothing is scanned, searched or
   saved. */

/** Everything a click on the import screens does. */
export type ImportActions = {
  chooseScope: (scope: ImportScope) => void;
  chooseAccount: (accountId: number) => void;
  showGroup: (group: ImportGroupKey) => void;
  showGame: (externalId: string) => void;
  setGameSelected: (externalId: string, checked: boolean) => void;
  setGamesSelected: (externalIds: readonly string[], checked: boolean) => void;
  importSelected: (externalIds: readonly string[]) => void;
  importOne: (externalId: string, next: string | null) => void;
  skip: (externalId: string, next: string | null) => void;
  unskip: (externalId: string) => void;
  pickGame: (externalId: string, game: GameMetadata) => void;
  setChoices: (externalId: string, games: GameMetadata[]) => void;
  replaceMatch: (externalId: string, game: GameMetadata) => void;
  setReplacementChoices: (externalId: string, games: GameMetadata[]) => void;
  /** Asks about a picked game ahead of Import. */
  lookUpPickedGame: (gameId: number) => void;
  searchGames: (
    apiEndpoint: string,
    query: string,
    options: { signal: AbortSignal; mainGamesAndRemastersOnly: boolean },
  ) => Promise<GameMetadata[]>;
  pickFile: (externalId: string, relativePath: string) => void;
  browseFile: (externalId: string) => void;
  /** The done screen's buttons. */
  reviewRemaining: () => void;
  showList: () => void;
  showUpdates: () => void;
  openMyGames: (providerId: BuiltinImportProviderId) => void;
};

const appActions: ImportActions = {
  chooseScope: chooseImportScope,
  chooseAccount: chooseImportAccount,
  showGroup: showImportGroup,
  showGame: showImportGame,
  setGameSelected,
  setGamesSelected,
  importSelected: (externalIds) => void importSelectedGames(externalIds),
  importOne: (externalId, next) => void importOneGame(externalId, next),
  skip: skipImportGame,
  unskip: unskipImportGame,
  pickGame: pickImportGame,
  setChoices: setImportChoices,
  replaceMatch: replaceImportMatch,
  setReplacementChoices,
  lookUpPickedGame: (gameId) => void lookUpPickedGame(gameId),
  searchGames: searchLibraryGames,
  pickFile: pickGameFile,
  browseFile: (externalId) => void browseGameFile(externalId),
  reviewRemaining: reviewRemainingGames,
  showList: showImportList,
  showUpdates: showImportUpdates,
  openMyGames: (providerId) => {
    const { setLibraryTab, setActiveView } = useAppStore.getState();
    setLibraryTab(providerId);
    setActiveView("games");
  },
};

/** The parts of the library the import screens judge a game by. */
export type ImportLibrary = {
  /** Games in My Games that came from a launcher, by launcher and ID. */
  libraryImports: ReadonlyMap<string, LibraryImportEntry>;
  ignoredProcesses: ReadonlySet<string>;
};

type SampleImportValue = { actions: ImportActions; library: ImportLibrary };

const SampleImportContext = createContext<SampleImportValue | null>(null);

/** The import screens inside it work on a sample, not on the app. */
export function SampleImport({
  actions,
  library,
  children,
}: SampleImportValue & { children: ReactNode }) {
  const value = useMemo(() => ({ actions, library }), [actions, library]);
  return (
    <SampleImportContext.Provider value={value}>
      {children}
    </SampleImportContext.Provider>
  );
}

export function useImportActions() {
  return useContext(SampleImportContext)?.actions ?? appActions;
}

/** Whether these screens show a guide's sample. */
export function useIsSampleImport() {
  return useContext(SampleImportContext) !== null;
}

export function useImportLibrary(): ImportLibrary {
  const sample = useContext(SampleImportContext)?.library;
  const libraryImports = useAppStore((state) => state.libraryImports);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  return useMemo(
    () => sample ?? { libraryImports, ignoredProcesses },
    [sample, libraryImports, ignoredProcesses],
  );
}
