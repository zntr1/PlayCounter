import { submitLocalLinkToCommunity } from "../tracker";
import { useAppStore } from "../store";
import type { LocalLinkRef } from "../localLinks";
import { commitLibraryImports } from "./commit";
import { libraryEntryKey, type LibraryImportCommit } from "./types";

export async function runLibraryImport(
  commits: readonly LibraryImportCommit[],
) {
  const persisted = commitLibraryImports(commits);
  const refs = customLinkRefsForCommits(commits);
  const shareOutcomes = await Promise.all(
    refs.map(async (ref) => ({
      ref,
      outcome: await submitLocalLinkToCommunity(ref),
    })),
  );
  return { persisted, shareOutcomes };
}

function customLinkRefsForCommits(
  commits: readonly LibraryImportCommit[],
): LocalLinkRef[] {
  const state = useAppStore.getState();
  const importedKeys = new Set(
    commits.map((commit) =>
      libraryEntryKey(commit.entry.provider, commit.entry.externalId),
    ),
  );
  const refs: LocalLinkRef[] = [];
  for (const [key, entry] of state.exeCache) {
    if (
      entry.state === "matched" &&
      entry.source === "custom" &&
      entry.libraryProvider &&
      entry.libraryExternalId &&
      importedKeys.has(
        libraryEntryKey(entry.libraryProvider, entry.libraryExternalId),
      ) &&
      entry.communitySuggestionId === undefined
    ) {
      refs.push({ kind: "exe", key });
    }
  }
  for (const [key, entry] of state.scopedExeLinks) {
    if (
      entry.source === "custom" &&
      importedKeys.has(libraryEntryKey(entry.provider, entry.externalId)) &&
      entry.communitySuggestionId === undefined
    ) {
      refs.push({ kind: "scoped", key });
    }
  }
  return refs;
}
