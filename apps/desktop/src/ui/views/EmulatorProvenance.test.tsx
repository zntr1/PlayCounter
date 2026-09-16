// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmulatorMapping } from "../../emulators/types";
import { useAppStore, type ActiveSession } from "../../store";
import {
  emulatorShareRuntimeContext,
  searchEmulatorGames,
} from "../../tracker";
import { MyGamesView } from "./MyGamesView";
import { DolphinView, DosboxView, Pcsx2View } from "./EmulatorsView";
import { ActiveGameHero } from "./ActiveGameHero";
import { HistorySessionRow } from "./history/HistorySessionRow";
import { EmulatorLinkedGameDialog } from "./emulators/EmulatorLinkedGameDialog";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const NAME = "Need for Speed: Underground 2";
const NOW = "2026-09-16T09:00:00Z";
const emulators = [
  { id: "pcsx2", label: "PCSX2", View: Pcsx2View },
  { id: "dolphin", label: "Dolphin", View: DolphinView },
  { id: "dosbox", label: "DOSBox", View: DosboxView },
];
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(NOW));
  vi.mocked(emulatorShareRuntimeContext).mockReturnValue({
    privateTokens: [],
    privacyReady: true,
    installUuid: "test-install",
    offline: false,
    serverUnavailable: false,
  });
  vi.mocked(searchEmulatorGames).mockResolvedValue([]);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryShowShelves: false,
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function savedGame(
  emulator: (typeof emulators)[number],
  overrides: Partial<EmulatorMapping> = {},
) {
  const contentKind = emulator.id === "dosbox" ? "program" : "rom";
  const contentValue =
    emulator.id === "dosbox" ? "nfs.exe" : "underground2.iso";
  const mapping: EmulatorMapping = {
    emulatorId: emulator.id,
    label: emulator.label,
    contentKey: `${emulator.id}:${contentKind}:${contentValue}`,
    contentKind,
    contentValue,
    display: contentValue,
    decision: "game",
    gameId: 192570,
    igdbId: 97,
    gameName: NAME,
    coverUrl: "",
    source: "igdb",
    confidence: "user",
    trust: "recognized",
    shareable: true,
    decidedAt: NOW,
    lastSeenAt: NOW,
    share: { status: "verified", gameId: 192570, submittedAt: NOW },
    ...overrides,
  };
  const context = {
    emulatorId: mapping.emulatorId,
    label: mapping.label,
    contentKey: mapping.contentKey,
    display: mapping.display,
    trust: mapping.trust,
  };
  const session: Session = {
    id: 1,
    gameId: mapping.gameId!,
    igdbId: mapping.igdbId,
    gameName: NAME,
    source: "igdb",
    exeName: "",
    startedAt: "2026-09-15T19:00:00Z",
    endedAt: "2026-09-15T20:00:00Z",
    durationSeconds: 3600,
    emulator: context,
  };
  const active: ActiveSession = {
    id: 2,
    gameId: session.gameId,
    igdbId: session.igdbId,
    gameName: NAME,
    coverUrl: "",
    source: "igdb",
    exeName: "",
    startedAt: NOW,
    checkpointedAt: NOW,
    emulator: context,
  };
  useAppStore.setState({
    emulatorMappings: new Map([[mapping.contentKey, mapping]]),
    recentSessions: [session],
  });
  return { mapping, session, active };
}

async function render(node: ReactNode) {
  await act(() => root.render(node));
}

function sourceBadges(element: ParentNode = container) {
  return [
    ...element.querySelectorAll<HTMLElement>(
      "[title], [role='img'][aria-label]",
    ),
  ]
    .map(
      (item) => item.getAttribute("title") ?? item.getAttribute("aria-label")!,
    )
    .filter((tip) => /^(IGDB|Community|Custom):/.test(tip));
}

function expectCommunity(element: ParentNode = container) {
  expect(sourceBadges(element)).toEqual([
    "Community: This emulator game match was approved by the community.",
  ]);
}

it.each(emulators)(
  "repairs saved $label badges in the library, list, and details without changing identity or totals",
  async (emulator) => {
    const { mapping, session, active } = savedGame(emulator);
    useAppStore.setState({
      activeSessions: [active],
      archivedGameSeconds: { "igdb:192570": 1800 },
    });
    const identities = {
      mapping: structuredClone(mapping),
      session: structuredClone(session),
      active: structuredClone(active),
    };
    await render(<MyGamesView />);
    const card = container.querySelector<HTMLElement>(".game-library-card")!;
    expect(card).not.toBeNull();
    expectCommunity(card);
    expect(card.textContent).toContain("1h 30m");
    await act(() =>
      card
        .querySelector<HTMLButtonElement>(
          `[aria-label="Open details for ${NAME}"]`,
        )!
        .click(),
    );
    expectCommunity(document.querySelector('[role="dialog"]')!);
    await act(() => {
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ];
      buttons.find((button) => button.textContent === "Close")!.click();
      useAppStore.getState().setMyGamesCardSize("list");
    });
    expectCommunity();
    expect(
      useAppStore.getState().emulatorMappings.get(mapping.contentKey),
    ).toEqual(identities.mapping);
    expect(useAppStore.getState().recentSessions).toEqual([identities.session]);
    expect(useAppStore.getState().activeSessions).toEqual([identities.active]);
  },
);

it.each(emulators)(
  "shows Community in the $label linked-game page and change dialog",
  async (emulator) => {
    const { mapping } = savedGame(emulator);
    await render(<emulator.View />);
    expectCommunity();
    await render(
      <EmulatorLinkedGameDialog mapping={mapping} onClose={() => {}} />,
    );
    expectCommunity(document.querySelector('[role="dialog"]')!);
  },
);

it.each(emulators)(
  "updates $label pending, approved, and revoked matches in Now Playing and History",
  async (emulator) => {
    const { mapping, session, active } = savedGame(emulator, {
      share: { status: "pending", gameId: 192570, submittedAt: NOW },
    });
    const view = (
      <>
        <ActiveGameHero
          session={active}
          elapsedSeconds={60}
          recentSessions={[session]}
          showDurationDays={false}
          exeCache={new Map()}
          resolveIgdbId={() => 97}
          archivedGameSeconds={{}}
          playtimeAdjustments={{}}
          statusLabel="Now emulating"
        />
        <HistorySessionRow
          session={session}
          resolveIgdbId={() => 97}
          selectedGameKey={null}
          onFilterGame={() => {}}
          onClearGameFilter={() => {}}
          onRequestDelete={() => {}}
        />
      </>
    );
    await render(view);
    expect(sourceBadges()).toHaveLength(2);
    expect(
      sourceBadges().every(
        (tip) =>
          tip.startsWith("Custom:") && tip.includes("waiting to be reviewed"),
      ),
    ).toBe(true);
    await act(() =>
      useAppStore.getState().setEmulatorMapping({
        ...mapping,
        share: { ...mapping.share!, status: "verified" },
      }),
    );
    expect(sourceBadges()).toEqual(
      Array(2).fill(
        "Community: This emulator game match was approved by the community.",
      ),
    );
    await act(() =>
      useAppStore.getState().setEmulatorMapping({
        ...mapping,
        confidence: "curated",
        share: { ...mapping.share!, status: "rejected" },
      }),
    );
    expect(sourceBadges()).toEqual(
      Array(2).fill("Custom: This emulator game match is saved on this PC."),
    );
  },
);

it("keeps real native IGDB evidence alongside an approved emulator link", async () => {
  savedGame(emulators[0]);
  useAppStore.setState({
    exeCache: new Map([
      [
        "speed2.exe",
        {
          exeName: "speed2.exe",
          gameId: 192570,
          igdbId: 97,
          gameName: NAME,
          source: "igdb",
          identifierSource: "igdb",
          state: "matched",
          lastCheckedAt: NOW,
        },
      ],
    ]),
  });
  await render(<MyGamesView />);
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(sourceBadges()).toEqual([
    "IGDB: IGDB has this file name on record for the game.",
    "Community: This emulator game match was approved by the community.",
  ]);
});

it("labels title-search guesses honestly and updates a pending library match after approval", async () => {
  const { mapping } = savedGame(emulators[0], {
    confidence: "probable",
    share: undefined,
  });
  await render(<MyGamesView />);
  expect(sourceBadges()).toEqual([
    "IGDB: Suggested from an IGDB game-title search. This file match has not been community approved.",
  ]);
  await act(() =>
    useAppStore.getState().setEmulatorMapping({
      ...mapping,
      share: { status: "pending", gameId: mapping.gameId!, submittedAt: NOW },
    }),
  );
  expect(sourceBadges()).toEqual([
    "Custom: This emulator game match is saved on this PC. Sent to the community and waiting to be reviewed.",
  ]);
  await act(() =>
    useAppStore.getState().setEmulatorMapping({
      ...mapping,
      share: { status: "verified", gameId: mapping.gameId!, submittedAt: NOW },
    }),
  );
  expectCommunity();
});

it("does not claim IGDB or Community provenance after the old session's mapping was forgotten", async () => {
  savedGame(emulators[0]);
  useAppStore.setState({ emulatorMappings: new Map() });
  await render(<MyGamesView />);
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(sourceBadges()).toEqual([]);
  expect(container.textContent).toContain(NAME);
  expect(container.textContent).toContain("PCSX2");
});

it("keeps a pending emulator link pending when another route has an older approval", async () => {
  savedGame(emulators[0], {
    share: { status: "pending", gameId: 192570, submittedAt: NOW },
  });
  useAppStore.setState({
    exeCache: new Map([
      [
        "speed2.exe",
        {
          exeName: "speed2.exe",
          gameId: -1,
          igdbId: 97,
          gameName: NAME,
          source: "custom",
          identifierSource: "custom",
          state: "matched",
          lastCheckedAt: NOW,
          communitySuggestionId: 84,
          communitySuggestionVerified: true,
          communitySuggestionStatus: "verified",
        },
      ],
    ]),
  });
  await render(<MyGamesView />);
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(sourceBadges()).toHaveLength(1);
  expect(sourceBadges()[0]).toContain("waiting to be reviewed");
  expect(sourceBadges()[0]).not.toContain("The community approved");
});

it("does not redraw history for last-seen updates but still reacts to review changes", async () => {
  const { mapping, session } = savedGame(emulators[0]);
  const onRender = vi.fn();
  await render(
    <Profiler id="history-row" onRender={onRender}>
      <HistorySessionRow
        session={session}
        resolveIgdbId={() => 97}
        selectedGameKey={null}
        onFilterGame={() => {}}
        onClearGameFilter={() => {}}
        onRequestDelete={() => {}}
      />
    </Profiler>,
  );
  const renders = onRender.mock.calls.length;
  await act(() =>
    useAppStore.getState().setEmulatorMapping({
      ...mapping,
      lastSeenAt: "2026-09-16T09:01:00Z",
    }),
  );
  expect(onRender).toHaveBeenCalledTimes(renders);
  await act(() =>
    useAppStore.getState().setEmulatorMapping({
      ...mapping,
      share: { ...mapping.share!, status: "pending" },
    }),
  );
  expect(onRender.mock.calls.length).toBeGreaterThan(renders);
  expect(sourceBadges()[0]).toContain("waiting to be reviewed");
});
