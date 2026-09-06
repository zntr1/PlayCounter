// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CommunityMetadataCandidate } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../requestJson";
import { useCommunityGameCorrection } from "./useCommunityGameCorrection";

vi.mock("../requestJson", () => ({ requestJson: vi.fn() }));
vi.mock("../store", () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      settings: { apiEndpoint: "https://api.example" },
      installUuid: "review-install",
    }),
  useIsOffline: () => false,
}));

type Props = Parameters<typeof useCommunityGameCorrection>[0];
let current: ReturnType<typeof useCommunityGameCorrection>;
let root: Root;
let container: HTMLDivElement;
let props: Props;
const requestMock = vi.mocked(requestJson);
const options = { sort: "relevance" } as const;
const candidate: CommunityMetadataCandidate = {
  igdbId: 42,
  name: "Game",
  coverUrl: "https://images.example/game.jpg",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe(input: Props) {
  current = useCommunityGameCorrection(input);
  return null;
}

async function render(next: Partial<Props> = {}) {
  props = { ...props, ...next };
  await act(() => root.render(createElement(Probe, props)));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requestMock.mockReset();
  props = {
    exeName: "Game.exe",
    onKnownGame: vi.fn(),
    onRejected: vi.fn(),
    onSuggested: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("community correction flow", () => {
  it("keeps the new query results when an older reply arrives last", async () => {
    const oldReply = deferred<unknown>();
    requestMock.mockReturnValueOnce(oldReply.promise);
    await act(() => current.setSearch("old query"));
    let oldSearch!: Promise<void>;
    await act(() => {
      oldSearch = current.searchFirstPage(options);
    });
    const oldSignal = requestMock.mock.calls[0][1]!.signal!;

    await act(() => current.setSearch("new query"));
    expect(oldSignal.aborted).toBe(true);
    requestMock.mockResolvedValueOnce({ candidates: [candidate] });
    await act(() => current.searchFirstPage(options));
    await act(async () => {
      oldReply.resolve({ candidates: [{ ...candidate, name: "Old result" }] });
      await oldSearch;
    });
    expect(current.candidates).toEqual([candidate]);
    expect(current.search).toBe("new query");
  });

  it("appends pages without duplicate games and retains the search options", async () => {
    requestMock.mockResolvedValueOnce({
      candidates: [candidate],
      hasMore: true,
      nextOffset: 40,
    });
    await act(() => current.setSearch("Game"));
    const filters = { sort: "release-desc", releaseYear: 2020 } as const;
    await act(() => current.searchFirstPage(filters));
    requestMock.mockResolvedValueOnce({
      candidates: [
        { ...candidate, name: "Updated" },
        { ...candidate, igdbId: 43 },
      ],
      hasMore: false,
    });
    await act(async () => {
      await current.loadMore(filters);
    });

    expect(current.candidates.map((item) => item.igdbId)).toEqual([42, 43]);
    expect(current.candidates[0].name).toBe("Updated");
    expect(current.hasMore).toBe(false);
    const url = new URL(requestMock.mock.calls[1][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "Game",
      offset: "40",
      releaseYear: "2020",
      sort: "release-desc",
    });
  });

  it("cancels and clears a closed dialog without accepting its late reply", async () => {
    const reply = deferred<unknown>();
    requestMock.mockReturnValueOnce(reply.promise);
    await act(() => current.setSearch("Game"));
    let search!: Promise<void>;
    await act(() => {
      search = current.searchFirstPage(options);
    });
    const signal = requestMock.mock.calls[0][1]!.signal!;
    await act(() => current.reset());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      reply.resolve({ candidates: [candidate] });
      await search;
    });
    expect(current.candidates).toEqual([]);
    expect(current.search).toBe("");
    expect(current.state).toBe("idle");
  });

  it("does not apply a late submission to a different scoped link", async () => {
    await render({ targetKey: "game.exe|c:\\one" });
    await act(() => current.applyCandidate(candidate));
    const reply = deferred<unknown>();
    requestMock.mockReturnValueOnce(reply.promise);
    let submission!: Promise<void>;
    await act(() => {
      submission = current.submit();
    });
    const signal = requestMock.mock.calls[0][1]!.signal!;

    await render({ targetKey: "game.exe|c:\\two" });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      reply.resolve({ id: 7, verified: true });
      await submission;
    });
    expect(current.selection).toBeNull();
    expect(props.onSuggested).not.toHaveBeenCalled();
  });

  it.each([
    {
      response: { igdbGame: { id: 42, name: "Known Game", coverUrl: "cover" } },
      callback: "onKnownGame" as const,
    },
    {
      response: { id: 7, rejected: true, reviewNote: "Wrong executable" },
      callback: "onRejected" as const,
    },
    { response: { id: 7, verified: true }, callback: "onSuggested" as const },
  ])(
    "sends one submission and dispatches $callback",
    async ({ response, callback }) => {
      await act(() => current.applyCandidate(candidate));
      const reply = deferred<unknown>();
      requestMock.mockReturnValueOnce(reply.promise);
      let submission!: Promise<void>;
      await act(() => {
        submission = current.submit();
        void current.submit();
      });
      expect(requestMock).toHaveBeenCalledOnce();
      expect(JSON.parse(requestMock.mock.calls[0][1]!.body as string)).toEqual({
        exeName: "Game.exe",
        name: candidate.name,
        coverUrl: candidate.coverUrl,
        igdbId: candidate.igdbId,
        installUuid: "review-install",
      });
      await act(async () => {
        reply.resolve(response);
        await submission;
      });
      expect(props[callback]).toHaveBeenCalledOnce();
      for (const other of [
        "onKnownGame",
        "onRejected",
        "onSuggested",
      ] as const) {
        if (other !== callback) expect(props[other]).not.toHaveBeenCalled();
      }
      if (callback === "onSuggested") {
        expect(props.onSuggested).toHaveBeenCalledWith(7, true, {
          selection: candidate,
        });
      }
      if (callback === "onRejected") {
        expect(props.onRejected).toHaveBeenCalledWith(7, "Wrong executable", {
          selection: candidate,
        });
      }
      expect(current.state).toBe("saved");
    },
  );
});
