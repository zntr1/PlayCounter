import {
  submitLocalLinkToCommunity,
  type LocalLinkShareOutcome,
} from "../tracker";
import { useAppStore } from "../store";
import { rateLimitDelay } from "../rateLimitedFetch";
import type { LocalLinkRef } from "../localLinks";
import { commitLibraryImports } from "./commit";
import { libraryEntryKey, type LibraryImportCommit } from "./types";

export async function runLibraryImport(
  commits: readonly LibraryImportCommit[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const persisted = commitLibraryImports(commits);
  const refs = customLinkRefsForCommits(commits);
  const shareOutcomes: { ref: LocalLinkRef; outcome: LocalLinkShareOutcome }[] =
    [];
  for (const ref of refs) {
    // Saving the local library happens first. Community submissions are
    // paced independently so a large first import cannot flood the API.
    if (shareOutcomes.length > 0) await pause(1_000, signal);
    let cooldown: number;
    while (
      (cooldown = rateLimitDelay(useAppStore.getState().settings.apiEndpoint)) >
      0
    ) {
      await pause(Math.min(cooldown, 60_000), signal);
    }
    signal?.throwIfAborted();
    shareOutcomes.push({
      ref,
      outcome: await submitLocalLinkToCommunity(ref, signal),
    });
  }
  signal?.throwIfAborted();
  return { persisted, shareOutcomes };
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
