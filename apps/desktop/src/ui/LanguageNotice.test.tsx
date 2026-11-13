// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { LanguageNotice } from "./LanguageNotice";

vi.mock("../i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../i18n")>()),
  appLanguage: () => "de",
}));

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
  vi.unstubAllGlobals();
});

it("closes like Keep: the language stays and the notice never comes back", async () => {
  await act(() => root.render(createElement(LanguageNotice)));
  expect(container.textContent).toContain("PlayCounter is now in Deutsch");

  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
      .click(),
  );
  expect(container.textContent).toBe("");
  expect(useAppStore.getState().languageNoticeSeen).toBe(true);
  expect(useAppStore.getState().settings.language ?? "system").toBe("system");
});
