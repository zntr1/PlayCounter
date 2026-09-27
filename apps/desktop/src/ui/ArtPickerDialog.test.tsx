// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { artForGame, searchArt } from "../gameArt";
import { useAppStore } from "../store";
import { ArtPickerDialog } from "./ArtPickerDialog";

vi.mock("../gameArt", () => ({
  searchArt: vi.fn(),
  artForGame: vi.fn(),
  downloadArtImage: vi.fn(),
}));
vi.mock("../tracker", () => ({ setCustomGameCover: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const game = { gameId: 0, source: "custom" as const, name: "Discord" };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(searchArt).mockResolvedValue([
    { id: 5, name: "Discord", verified: true },
  ]);
  vi.mocked(artForGame)
    .mockReset()
    .mockResolvedValue({ covers: [], heroes: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openPicker(showAdultArt: boolean, forSharing: boolean) {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, showAdultArt },
  }));
  await act(async () =>
    root.render(
      createElement(ArtPickerDialog, {
        game: { ...game, canEditCover: true },
        onClose: vi.fn(),
        onPickCover: vi.fn(),
        forSharing,
      }),
    ),
  );
}

it.each([
  { showAdultArt: true, forSharing: false, adult: true },
  { showAdultArt: true, forSharing: true, adult: false },
  { showAdultArt: false, forSharing: false, adult: false },
])(
  "asks for 18+ art only when the setting is on and the pick is not shared: %j",
  async ({ showAdultArt, forSharing, adult }) => {
    await openPicker(showAdultArt, forSharing);
    expect(artForGame).toHaveBeenCalledWith(5, { adult });
  },
);
