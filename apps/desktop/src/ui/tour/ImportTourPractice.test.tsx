// @vitest-environment happy-dom
/* The practice importer of "Import a launcher library": the app's own import
   screens (launcher card, the four groups, the list, the game's box, the
   import bar, the done screen) on sample games. Nothing is scanned, signed
   in, searched on the server or saved; what is imported stays in the guide. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  run: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../library/importRun", () => ({
  runLibraryImport: mocks.run,
  importNowShareLater: mocks.run,
}));
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

import { applyLanguage } from "../../i18n";
import { useImportSession } from "../../library/importSession";
import { useAppStore } from "../../store";
import { ImportTourPractice } from "./ImportTourPractice";
import { TOUR_EVENT } from "./tourEvents";

type Shelf = "ready" | "attention" | "imported" | "unavailable";

const PICK_GAME = "Grand Theft Auto V Enhanced";
const PICK_FILE = "Halo: The Master Chief Collection";

let root: Root;
let container: HTMLDivElement;
let finished: string[];
const onTourEvent = (event: Event) =>
  finished.push((event as CustomEvent<{ name: string }>).detail.name);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  applyLanguage("en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  finished = [];
  window.addEventListener(TOUR_EVENT, onTourEvent);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  window.removeEventListener(TOUR_EVENT, onTourEvent);
  vi.unstubAllGlobals();
});

/** Shows the sample at a step, the way the guide moves on to it. */
async function show(stepId: string) {
  await act(() => root.render(<ImportTourPractice stepId={stepId} />));
}

/** Back, or a click on a finished step in the guide's list. */
async function jumpBackTo(stepId: string) {
  await act(() => {
    useAppStore.setState((state) => ({
      demoResetToken: state.demoResetToken + 1,
    }));
    root.render(<ImportTourPractice stepId={stepId} />);
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}

async function click(label: string) {
  const found = button(label);
  expect(found, label).toBeDefined();
  await act(() => found!.click());
}

function count(group: Shelf) {
  return Number(
    container.querySelector(`#import-tab-${group} .tabular-nums`)?.textContent,
  );
}

const counts = () =>
  Object.fromEntries(
    (["ready", "attention", "imported", "unavailable"] as const).map(
      (group) => [group, count(group)],
    ),
  );

async function open(group: Shelf) {
  await act(() =>
    container.querySelector<HTMLButtonElement>(`#import-tab-${group}`)!.click(),
  );
}

/** The game titles in the list of the open group. */
const listed = () =>
  [
    ...container.querySelectorAll(
      '[role="tabpanel"] button[aria-current] .font-semibold',
    ),
  ].map((title) => title.textContent);

async function openGame(title: string) {
  const row = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[role="tabpanel"] button[aria-current]',
    ),
  ].find((item) => item.querySelector(".font-semibold")?.textContent === title);
  expect(row, title).toBeDefined();
  await act(() => row!.click());
}

const files = (gameName: string) => [
  ...container.querySelectorAll<HTMLInputElement>(
    `[role="radiogroup"][aria-label="Game file for ${gameName}"] input`,
  ),
];

async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the practice importer", () => {
  it("starts on the launcher card, as a real import does", async () => {
    await show("start");
    expect(container.textContent).toContain("What to import");
    expect(button("Find games")).toBeDefined();
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await click("Find games");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(finished).toEqual(["demo.step-completed"]);
  });

  it("sorts sample games into the importer's four groups", async () => {
    await show("ready");
    for (const label of [
      "Ready to import",
      "Needs you",
      "Already in My Games",
      "Can't import",
    ])
      expect(
        [...container.querySelectorAll('[role="tab"]')].some((tab) =>
          tab.textContent?.includes(label),
        ),
        label,
      ).toBe(true);
    // A few ready, one that needs a game, one that needs its file, one that
    // is in My Games already.
    expect(counts()).toEqual({
      ready: 3,
      attention: 2,
      imported: 1,
      unavailable: 0,
    });
    expect(listed()).toEqual([
      "Diablo IV",
      "Forza Horizon 5",
      "Sea of Thieves",
    ]);
    await open("attention");
    expect(container.textContent).toContain("Pick the game");
    expect(container.textContent).toContain("Pick the file");
  });

  it("shows no trace of the old hand-built form", async () => {
    for (const step of ["start", "ready", "pick-game", "pick-file", "import"]) {
      await show(step);
      const text = container.textContent ?? "";
      expect(text, step).not.toContain("Game executable");
      expect(text, step).not.toContain("Uninstall.exe");
      expect(text, step).not.toContain("eligible");
      expect(container.querySelector("select"), step).toBeNull();
    }
  });

  it("asks which game it is, with covers and a search", async () => {
    await show("pick-game");
    expect(container.textContent).toContain(`Which game is “${PICK_GAME}”?`);
    expect(
      container.querySelector('[aria-pressed="true"]')?.textContent,
    ).toContain("Grand Theft Auto V");
    expect(button("Skip for now")).toBeDefined();
    expect(button("Import")?.disabled).toBe(false);
  });

  it("answers a search from the bundled sample titles", async () => {
    await show("pick-game");
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search by game title or IGDB ID"]',
    )!;
    await type(search, "zelda");
    await act(async () => {
      search.form!.requestSubmit();
    });
    expect(
      [...container.querySelectorAll("[aria-pressed]")].map((tile) =>
        tile.textContent?.replace("Sample", ""),
      ),
    ).toEqual(["The Legend of Zelda: The Wind Waker"]);

    await type(search, "no such game");
    await act(async () => {
      search.form!.requestSubmit();
    });
    expect(container.textContent).toContain("No matching games found.");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("imports a game that needed a pick, inside the guide only", async () => {
    await show("pick-game");
    await click("Import");

    expect(counts()).toMatchObject({ attention: 1, imported: 2 });
    // The next game that needs the player shows at once, as in the app.
    expect(container.textContent).toContain("Which file starts the game?");
    expect(finished).toEqual(["demo.step-completed"]);

    // Nothing reached the app: no library entry, no backup, no real import.
    expect(useAppStore.getState().libraryImports.size).toBe(0);
    expect(useImportSession.getState().session.scan).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("wants the file of an installed game before it imports it", async () => {
    await show("pick-file");
    expect(container.textContent).toContain("Which file starts the game?");
    // The matched game can be doubted, as every matched game.
    expect(button("Wrong game?")).toBeDefined();
    expect(files(PICK_FILE).map((input) => input.value)).toEqual([
      "MCC\\Binaries\\Win64\\MCC-Win64-Shipping.exe",
      "mcclauncher.exe",
    ]);
    expect(button("Import")?.disabled).toBe(true);

    await act(() => files(PICK_FILE)[0].click());
    expect(button("Import")?.disabled).toBe(false);
    expect(finished).toEqual([]);

    await click("Import");
    expect(count("attention")).toBe(0);
    expect(finished).toEqual(["demo.step-completed"]);
  });

  it("imports the checked games with the bar and says what came in", async () => {
    await show("import");
    expect(count("ready")).toBe(3);
    await click("Import 3 games");

    expect(container.textContent).toContain("3 games imported from Xbox");
    expect(container.textContent).toContain(
      "Their playtime is in My Games now.",
    );
    expect(finished).toEqual(["demo.step-completed"]);
    expect(useAppStore.getState().libraryImports.size).toBe(0);
    expect(useAppStore.getState().toasts).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("shows imported games with what an import again would bring", async () => {
    await show("again");
    expect(
      container
        .querySelector("#import-tab-imported")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(listed()).toContain("Diablo IV");
    // A game that was in My Games before has new playtime to bring.
    expect(container.textContent).toContain("New playtime");
    expect(container.textContent).toContain("12h 0m → 15h 30m");
    expect(button("Update 1 game")).toBeDefined();
  });

  it("only counts the action the step asks for", async () => {
    // The file game imported during the "pick the game" step is not that
    // step's task.
    await show("pick-game");
    await openGame(PICK_FILE);
    await act(() => files(PICK_FILE)[0].click());
    await click("Import");
    expect(count("attention")).toBe(1);
    expect(finished).toEqual([]);

    // Nor is an empty click on the bar.
    await show("import");
    await click("Select none");
    expect(button("Import 0 games")?.disabled).toBe(true);
    expect(finished).toEqual([]);
  });

  it("sets every step up from anywhere", async () => {
    const shows: Record<string, () => void> = {
      start: () => expect(button("Find games")).toBeDefined(),
      ready: () =>
        expect(
          container
            .querySelector("#import-tab-ready")
            ?.getAttribute("aria-selected"),
        ).toBe("true"),
      "pick-game": () =>
        expect(container.textContent).toContain(
          `Which game is “${PICK_GAME}”?`,
        ),
      "pick-file": () => expect(files(PICK_FILE)).toHaveLength(2),
      import: () => expect(button("Import 3 games")).toBeDefined(),
      totals: () =>
        expect(container.textContent).toContain("3 games imported from Xbox"),
      "auto-add": () => expect(button("Open My Games")).toBeDefined(),
      again: () =>
        expect(
          container
            .querySelector("#import-tab-imported")
            ?.getAttribute("aria-selected"),
        ).toBe("true"),
    };
    // Each one first on a fresh sample, then reached by a jump from the end.
    for (const [step, check] of Object.entries(shows)) {
      await act(() => root.unmount());
      root = createRoot(container);
      await show(step);
      check();
    }
    for (const [step, check] of Object.entries(shows).reverse()) {
      await jumpBackTo(step);
      check();
    }
  });

  it("puts a finished step back to its start on a jump back", async () => {
    await show("pick-game");
    await click("Import");
    expect(count("attention")).toBe(1);

    await jumpBackTo("pick-game");
    expect(count("attention")).toBe(2);
    expect(container.textContent).toContain(`Which game is “${PICK_GAME}”?`);
    // Being put back is not the player's doing.
    expect(finished).toEqual(["demo.step-completed"]);
  });

  it("keeps what the player did when the guide moves on", async () => {
    await show("pick-game");
    await act(() =>
      [...container.querySelectorAll<HTMLButtonElement>("[aria-pressed]")]
        .find((tile) => tile.textContent?.includes("Grand Theft Auto Online"))!
        .click(),
    );
    await click("Import");

    await show("pick-file");
    expect(files(PICK_FILE)).toHaveLength(2);
    await open("imported");
    expect(listed()).toContain("Grand Theft Auto Online");
    expect(listed()).not.toContain("Grand Theft Auto V");
  });

  it("starts over with Scan again", async () => {
    await show("pick-game");
    await click("Import");
    await click("Scan again");
    expect(counts()).toMatchObject({ ready: 3, attention: 2, imported: 1 });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
