// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type ViewId } from "../../store";
import { GlobalSearch } from "./GlobalSearch";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
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

// Who clears the title bar's text when Escape is pressed outside the field.
// My Games, My History and Discovered do it themselves (see their tests).
// A new view fails to compile until it is listed here.
const escapeOwner: Record<ViewId, "title bar" | "page"> = {
  now: "title bar",
  emulating: "title bar",
  dosbox: "title bar",
  dolphin: "title bar",
  pcsx2: "title bar",
  mgba: "title bar",
  cemu: "title bar",
  rpcs3: "title bar",
  ppsspp: "title bar",
  duckstation: "title bar",
  ryujinx: "title bar",
  eden: "title bar",
  azahar: "title bar",
  melonds: "title bar",
  xenia: "title bar",
  bluestacks: "title bar",
  games: "page",
  import: "title bar",
  accounts: "title bar",
  discovered: "page",
  history: "page",
  achievements: "title bar",
  software: "title bar",
  settings: "title bar",
  dev: "title bar",
};

it.each(Object.entries(escapeOwner))(
  "Escape anywhere on %s is handled by the %s",
  async (view, owner) => {
    useAppStore.setState({
      activeView: view as ViewId,
      libraryQuery: "zelda",
      historyQuery: "zelda",
    });
    await act(() => root.render(<GlobalSearch />));
    const input = container.querySelector<HTMLInputElement>(
      '[role="search"] input',
    )!;
    expect(input.value).toBe("zelda");

    await act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(input.value).toBe(owner === "title bar" ? "" : "zelda");
  },
);

// docs/history-ranges-plan.md 33–36: a game filter is a chip in the box.
describe("game filter chip on My History", () => {
  const input = () =>
    container.querySelector<HTMLInputElement>('[role="search"] input')!;
  const chip = () => container.querySelector("[data-history-game-filter]");

  async function type(value: string) {
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(key: string) {
    await act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  beforeEach(() => {
    useAppStore.setState({ activeView: "history" });
    useAppStore.getState().setHistoryGameKey("custom:-1", "The Witcher 3");
  });

  it("shows the game's name with × instead of text, on My History only", async () => {
    await act(() => root.render(<GlobalSearch />));
    expect(chip()?.textContent).toBe("The Witcher 3");
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("");
    await act(() => useAppStore.getState().setActiveView("games"));
    expect(chip()).toBeNull();
  });

  it("removes the chip with × and with Backspace in the empty box", async () => {
    await act(() => root.render(<GlobalSearch />));
    await act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Clear game filter"]')!
        .click(),
    );
    expect(chip()).toBeNull();
    expect(useAppStore.getState().historyGameKey).toBeNull();
    expect(useAppStore.getState().historyGameName).toBeNull();

    await act(() =>
      useAppStore.getState().setHistoryGameKey("custom:-1", "The Witcher 3"),
    );
    await press("Backspace");
    expect(chip()).toBeNull();
    expect(useAppStore.getState().historyGameKey).toBeNull();
  });

  it("replaces the chip with a text search when typing", async () => {
    await act(() => root.render(<GlobalSearch />));
    await type("ha");
    expect(chip()).toBeNull();
    expect(useAppStore.getState().historyGameKey).toBeNull();
    expect(useAppStore.getState().historyQuery).toBe("ha");
    expect(input().value).toBe("ha");
  });
});
