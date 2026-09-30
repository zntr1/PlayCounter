// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  games: "page",
  import: "title bar",
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
