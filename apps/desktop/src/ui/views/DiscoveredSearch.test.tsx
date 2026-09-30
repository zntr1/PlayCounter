// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { GlobalSearch } from "../shell/GlobalSearch";
import { DiscoveredView } from "./DiscoveredView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "discovered" });
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

const press = (key: string, target: EventTarget, ctrlKey = false) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

async function typeInto(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Like App.tsx, Discovered is mounted only while it is the open view.
function Shell() {
  const onDiscovered = useAppStore(
    (state) => state.activeView === "discovered",
  );
  return (
    <>
      <GlobalSearch />
      {onDiscovered ? <DiscoveredView /> : null}
    </>
  );
}

it("takes Ctrl+F for its own search field and clears it with Escape", async () => {
  await act(() => root.render(<Shell />));
  const pageSearch = container.querySelector<HTMLInputElement>(
    '[placeholder="Search apps..."]',
  )!;
  const titleSearch = container.querySelector<HTMLInputElement>(
    '[role="search"] input',
  )!;
  expect(container.querySelector('[role="search"] kbd')).toBeNull();

  await press("f", document.body, true);
  expect(document.activeElement).toBe(pageSearch);

  // In the field, and from anywhere once nothing else owns the key.
  await typeInto(pageSearch, "steam");
  await press("Escape", pageSearch);
  expect(pageSearch.value).toBe("");

  await typeInto(pageSearch, "steam");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  try {
    await press("Escape", document.body);
    expect(pageSearch.value).toBe("steam");
  } finally {
    dialog.remove();
  }
  await press("Escape", titleSearch);
  expect(pageSearch.value).toBe("steam");
  await press("Escape", document.body);
  expect(pageSearch.value).toBe("");

  // Every other view still sends Ctrl+F to the title bar.
  await act(() => useAppStore.getState().setActiveView("now"));
  await press("f", document.body, true);
  expect(document.activeElement).toBe(titleSearch);
});
