// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { WelcomePrompt } from "./TourUI";
import { defaultTourProgress } from "./tourState";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ tourProgress: defaultTourProgress() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openWelcome() {
  await act(async () => root.render(<WelcomePrompt />));
  await act(async () => {
    vi.advanceTimersByTime(1300);
  });
}

function softwareSwitch() {
  const label = [...document.querySelectorAll("label")].find((element) =>
    element.textContent?.includes("Track software"),
  );
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function button(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === name,
  )!;
}

it("offers software tracking, on by default, and saves turning it off", async () => {
  await openWelcome();
  const toggle = softwareSwitch();
  expect(toggle).toBeTruthy();
  expect(toggle!.checked).toBe(true);

  await act(async () => toggle!.click());
  await act(async () => button("Maybe later").click());

  expect(useAppStore.getState().settings.trackTools).toBe(false);
});

it("turns software tracking on when the switch is not touched", async () => {
  await openWelcome();
  await act(async () => button("Maybe later").click());

  expect(useAppStore.getState().settings.trackTools).toBe(true);
});
