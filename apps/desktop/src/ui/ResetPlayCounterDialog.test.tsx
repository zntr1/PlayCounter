// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { resetMock, resetSettingsMock } = vi.hoisted(() => ({
  resetMock: vi.fn(),
  resetSettingsMock: vi.fn(),
}));
vi.mock("../resetLocalData", () => ({ resetLocalData: resetMock }));
vi.mock("../resetSettings", () => ({ resetSettings: resetSettingsMock }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.1.18"),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => true),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));

import { SettingsView } from "./views/SettingsView";
import { useAppStore } from "../store";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetMock.mockReset();
  resetSettingsMock.mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(SettingsView)));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}

async function click(label: string) {
  await act(() => button(label).click());
}

it("offers a separate settings-only reset with cancellation and confirmation", async () => {
  await click("Reset settings");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Backup files and backup preferences stay as they are.",
  );
  await click("Cancel");
  expect(resetSettingsMock).not.toHaveBeenCalled();
  await click("Reset settings");
  await click("Restore defaults");
  expect(resetSettingsMock).toHaveBeenCalledOnce();
  expect(resetMock).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    useAppStore
      .getState()
      .toasts.some((toast) => toast.title === "Settings reset"),
  ).toBe(true);
});

it("shows settings reset errors and blocks dismissal during a retry", async () => {
  resetSettingsMock.mockRejectedValueOnce(new Error("Startup access denied"));
  await click("Reset settings");
  await click("Restore defaults");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Startup access denied",
  );
  expect(
    useAppStore
      .getState()
      .toasts.some((toast) => toast.title === "Settings reset"),
  ).toBe(false);
  resetSettingsMock.mockReturnValue(new Promise(() => {}));
  await click("Restore defaults");
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(button("Cancel").disabled).toBe(true);
  expect(button("Resetting…").disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(resetSettingsMock).toHaveBeenCalledTimes(2);
});

it("requires explicit confirmation from Settings and safely cancels with Cancel or Escape", async () => {
  await click("Reset PlayCounter");
  expect(resetMock).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(
    "Any data not in a backup will be lost.",
  );
  expect(dialog.textContent).toContain("All backup files are kept");
  expect(dialog.textContent).toContain("Automatic backups will be paused");
  expect(dialog.querySelector("[data-autofocus]")?.textContent).toBe("Cancel");
  await click("Cancel");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("Reset PlayCounter");
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(resetMock).not.toHaveBeenCalled();
});

it("blocks duplicate confirmation and dismissal while data is being erased", async () => {
  resetMock.mockReturnValue(new Promise(() => {}));
  await click("Reset PlayCounter");
  await click("Erase data and restart");
  expect(button("Resetting…").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
  await act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    (
      document.querySelector(
        '[role="dialog"] button[aria-label="Close"]',
      ) as HTMLButtonElement
    ).click();
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(resetMock).toHaveBeenCalledOnce();
});

it("keeps a partial failure visible and allows retry instead of resuming stale data", async () => {
  resetMock.mockRejectedValueOnce(new Error("A cover file is locked"));
  await click("Reset PlayCounter");
  await click("Erase data and restart");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "A cover file is locked",
  );
  expect(button("Reload PlayCounter").disabled).toBe(false);
  resetMock.mockReturnValue(new Promise(() => {}));
  await click("Retry reset");
  expect(resetMock).toHaveBeenCalledTimes(2);
  expect(button("Resetting…").disabled).toBe(true);
});
