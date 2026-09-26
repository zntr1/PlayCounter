// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { localDayKey } from "../../toolUsage";
import { SoftwareView } from "./SoftwareView";

vi.mock("../../tracker", () => ({
  setToolArt: vi.fn(),
  setUserIgnoredProcess: vi.fn(),
  unmarkLocalTool: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no icon")),
  convertFileSrc: (value: string) => value,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, trackTools: true },
    exeCache: new Map([
      [
        "discord.exe",
        {
          exeName: "Discord.exe",
          state: "tool",
          gameId: 7,
          gameName: "Discord",
          coverUrl: "",
          source: "community",
          lastCheckedAt: "2026-09-26T00:00:00.000Z",
        },
      ],
    ]),
    toolUsage: {
      "discord.exe": { days: { [localDayKey(Date.now())]: 3600 } },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const card = () =>
  container.querySelector<HTMLElement>('[aria-label="Discord, details"]')!;
const detailsOpen = () =>
  Boolean(document.body.textContent?.includes("First tracked"));

it("opens the stats on click, but not from the card's menu", async () => {
  await act(async () => root.render(<SoftwareView />));

  await act(async () => {
    card().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }),
    );
  });
  const copy = [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.textContent?.includes("Copy File Name"),
  )!;
  await act(async () => copy.click());
  expect(detailsOpen()).toBe(false);

  await act(async () => card().click());
  expect(detailsOpen()).toBe(true);
  expect(document.body.textContent).toContain("Days used");
});
