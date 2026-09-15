// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invokeMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock, save: vi.fn() }));

import { AutomaticBackupSettings } from "./AutomaticBackupSettings";
import { useAutomaticBackupStore } from "../automaticBackups";
import { useAppStore } from "../store";

let container: HTMLDivElement;
let root: Root;
const defaultDirectory = "C:\\AppData\\PlayCounter\\backups\\automatic";

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  invokeMock.mockReset();
  openMock.mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAutomaticBackupStore.setState(
    {
      ...useAutomaticBackupStore.getInitialState(),
      loaded: true,
      defaultDirectory,
    },
    true,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(AutomaticBackupSettings)));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(() => button!.click());
}

it("keeps the app-data default after cancellation and supports choosing, opening, and resetting a folder", async () => {
  expect(container.textContent).toContain(defaultDirectory);
  expect(container.textContent).toContain("No automatic backups saved yet");
  openMock.mockResolvedValueOnce(null).mockResolvedValueOnce("D:\\My backups");
  await click("Choose folder");
  expect(useAutomaticBackupStore.getState().preferences.directory).toBeNull();
  expect(openMock).toHaveBeenCalledWith(
    expect.objectContaining({
      directory: true,
      multiple: false,
      defaultPath: defaultDirectory,
    }),
  );
  await click("Choose folder");
  expect(container.textContent).toContain("D:\\My backups");
  await click("Open folder");
  expect(invokeMock).toHaveBeenCalledWith("open_backup_directory", {
    directory: "D:\\My backups",
  });
  await click("Use app data");
  expect(useAutomaticBackupStore.getState().preferences.directory).toBeNull();
  expect(container.textContent).toContain(defaultDirectory);
});

it("shows write failures, allows retry, and prevents edits while a backup is running", async () => {
  await act(() =>
    useAutomaticBackupStore.setState((state) => ({
      preferences: { ...state.preferences, enabled: false },
    })),
  );
  invokeMock.mockRejectedValueOnce("Disk full");
  await click("Back up now");
  expect(container.textContent).toContain("Backup error: Disk full");
  let resolve!: (value: unknown) => void;
  invokeMock.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click("Back up now");
  expect(container.textContent).toContain("Saving backup");
  expect(
    [...container.querySelectorAll("button, select, input")].every(
      (control) => (control as HTMLInputElement).disabled,
    ),
  ).toBe(true);
  await act(() =>
    resolve({
      path: `${defaultDirectory}\\snapshot.json`,
      cleanupWarning: null,
    }),
  );
  expect(container.textContent).toContain("Last backup:");
  expect(container.textContent).not.toContain("Disk full");
  expect(useAutomaticBackupStore.getState().preferences.enabled).toBe(false);
});

it("keeps folder errors visible and renders retention warnings separately from failed backups", async () => {
  invokeMock.mockRejectedValueOnce("Drive disconnected");
  await click("Open folder");
  expect(container.textContent).toContain(
    "Folder unavailable: Drive disconnected",
  );
  invokeMock.mockResolvedValueOnce({
    path: `${defaultDirectory}\\snapshot.json`,
    cleanupWarning: "An older file is locked",
  });
  await click("Back up now");
  expect(container.textContent).toContain(
    "Backup saved, but older backups could not be removed",
  );
  expect(container.textContent).not.toContain("Backup error:");
});
