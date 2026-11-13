// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "games" });
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

function emptyPanelButton(label: string) {
  const heading = [...container.querySelectorAll("h2")].find(
    (node) => node.textContent === "No games detected yet",
  );
  const panel = heading?.closest("section, div.overflow-hidden");
  return [...(panel?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent?.trim() === label,
  );
}

it("an empty library offers Add game, and it opens the Add game dialog", async () => {
  await act(() => root.render(<MyGamesView />));

  const button = emptyPanelButton("Add game");
  expect(button).toBeDefined();
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await act(() => button!.click());

  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("Add game in an empty library waits for a connection when offline", async () => {
  useAppStore.setState({
    backendHealth: { ...useAppStore.getState().backendHealth, status: "offline" },
  });
  await act(() => root.render(<MyGamesView />));

  const button = emptyPanelButton("Add game");
  expect(button?.disabled).toBe(true);
  expect(button?.title).toBe("Needs a connection");
});
