import { useState } from "react";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  Game,
} from "@playcounter/shared";
import {
  communityMetadataSearchUrl,
  mergeCommunityMetadataCandidates,
  type CommunityMetadataSearchOptions,
} from "../../../communityMetadataSearch";
import { useAppStore, useIsOffline } from "../../../store";

/* Searching the database and sending a correction ────────────────────────────
   The ambiguity picker and the "wrong game" dialog run the same flow: search
   IGDB through the API, page through results, pick one with cover art, post it
   as a community suggestion. Only what happens with the answer differs, so the
   three outcomes are handed back to the caller together with the selection. */

export type CommunityCorrectionState =
  | "idle"
  | "loading"
  | "loading-more"
  | "saving"
  | "saved"
  | "error";

export type CommunityCorrectionOutcome = {
  selection: CommunityMetadataCandidate & { coverUrl: string };
};

export function useCommunityGameCorrection({
  exeName,
  onKnownGame,
  onRejected,
  onSuggested,
}: {
  exeName: string;
  /** The API already knows this game: it was applied directly. */
  onKnownGame: (game: Game) => void;
  /** Reviewed before and turned down; `id` is the earlier suggestion. */
  onRejected: (
    id: number,
    reviewNote: string | undefined,
    outcome: CommunityCorrectionOutcome,
  ) => void;
  /** Accepted for review (or auto-verified). */
  onSuggested: (
    id: number,
    verified: boolean,
    outcome: CommunityCorrectionOutcome,
  ) => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const isOffline = useIsOffline();
  const [search, setSearchValue] = useState("");
  const [candidates, setCandidates] = useState<CommunityMetadataCandidate[]>(
    [],
  );
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [selection, setSelection] = useState<CommunityMetadataCandidate | null>(
    null,
  );
  const [state, setState] = useState<CommunityCorrectionState>("idle");
  const [message, setMessage] = useState("");

  function resetResults() {
    setSelection(null);
    setCandidates([]);
    setHasMore(false);
    setNextOffset(0);
    setMessage("");
  }

  function reset() {
    setSearchValue("");
    resetResults();
    setState("idle");
  }

  function setSearch(value: string) {
    setSearchValue(value);
    resetResults();
  }

  async function searchPage(
    offset: number,
    append: boolean,
    options: CommunityMetadataSearchOptions,
  ) {
    const query = search.trim();
    if (query.length < 2 || isOffline) return;

    setState(append ? "loading-more" : "loading");
    setMessage("");
    if (!append) setCandidates([]);
    try {
      const response = await fetch(
        communityMetadataSearchUrl(apiEndpoint, query, offset, options),
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      const results = append
        ? mergeCommunityMetadataCandidates(candidates, body.candidates)
        : body.candidates;
      setCandidates(results);
      setHasMore(Boolean(body.hasMore));
      setNextOffset(body.nextOffset ?? 0);
      setMessage(
        results.length > 0
          ? body.hasMore
            ? `${results.length} matches shown. Load more to keep looking.`
            : `All ${results.length} matches shown. Pick the game you started.`
          : "No matching games found.",
      );
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  function searchFirstPage(options: CommunityMetadataSearchOptions) {
    return searchPage(0, false, options);
  }

  function loadMore(options: CommunityMetadataSearchOptions) {
    if (!hasMore) return;
    return searchPage(nextOffset, true, options);
  }

  function applyCandidate(candidate: CommunityMetadataCandidate) {
    if (!candidate.coverUrl) {
      setSelection(null);
      setMessage(
        `${candidate.name} has no cover art. Pick a result with cover art.`,
      );
      return;
    }
    setSelection(candidate);
    setMessage(`Selected ${candidate.name} from the database.`);
  }

  async function submit() {
    if (!selection?.coverUrl) return;
    const chosen = { ...selection, coverUrl: selection.coverUrl };

    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`${apiEndpoint}/api/community/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exeName,
          name: chosen.name,
          coverUrl: chosen.coverUrl,
          igdbId: chosen.igdbId,
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      if (result.igdbGame) {
        setState("saved");
        onKnownGame(result.igdbGame);
        return;
      }
      if (result.id === undefined) throw new Error("Unexpected response");
      setState("saved");
      if (result.rejected) {
        onRejected(result.id, result.reviewNote, { selection: chosen });
        return;
      }
      onSuggested(result.id, result.verified ?? false, { selection: chosen });
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  return {
    isOffline,
    search,
    setSearch,
    candidates,
    hasMore,
    selection,
    state,
    message,
    resetResults,
    reset,
    searchFirstPage,
    loadMore,
    applyCandidate,
    submit,
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
