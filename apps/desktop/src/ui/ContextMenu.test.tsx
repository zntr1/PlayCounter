// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSubmenu,
  hasOpenContextMenu,
} from "./ContextMenu";
import { Modal, useEscapeKey } from "./primitives";

let root: Root;
let container: HTMLDivElement;
const action = vi.fn();
const closed = vi.fn();
const dialogClosed = vi.fn();

function Example({ position = { x: 40, y: 40 } }) {
  const [open, setOpen] = useState(true);
  useEscapeKey(dialogClosed);
  return (
    <ContextMenu
      open={open}
      position={position}
      focusFirstItem
      ariaLabel="Game actions"
      onClose={() => {
        closed();
        setOpen(false);
      }}
    >
      <ContextMenuItem onClick={action}>Details</ContextMenuItem>
      <ContextMenuItem disabled onClick={action}>
        Unavailable
      </ContextMenuItem>
      <ContextMenuSubmenu label="Playtime">
        <ContextMenuItem
          onClick={() => {
            action();
            setOpen(false);
          }}
        >
          Log session
        </ContextMenuItem>
        <ContextMenuItem onClick={action}>Adjust total</ContextMenuItem>
      </ContextMenuSubmenu>
      <ContextMenuSubmenu label="Artwork">
        <ContextMenuItem onClick={action}>Choose artwork</ContextMenuItem>
      </ContextMenuSubmenu>
      <ContextMenuItem danger onClick={action}>
        Remove
      </ContextMenuItem>
    </ContextMenu>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  action.mockClear();
  closed.mockClear();
  dialogClosed.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const item = (text: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>("[data-context-menu-item]"),
  ].find((node) => node.textContent?.trim() === text)!;
const menus = () => document.querySelectorAll('[role="menu"]');
async function key(value: string) {
  await act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

it("closes only the topmost dialog on Escape", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [new DOMRect(0, 0, 400, 300)] as unknown as DOMRectList,
  );
  function NestedDialogs() {
    const [inner, setInner] = useState(true);
    return (
      <>
        <Modal
          title="Sample history"
          labelId="history-title"
          onClose={dialogClosed}
        >
          History
        </Modal>
        {inner ? (
          <Modal
            title="Sample journal"
            labelId="journal-title"
            onClose={() => {
              closed();
              setInner(false);
            }}
          >
            Journal
          </Modal>
        ) : null}
      </>
    );
  }
  await act(() => root.render(<NestedDialogs />));
  await key("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
  expect(dialogClosed).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await key("Escape");
  expect(dialogClosed).toHaveBeenCalledTimes(1);
});

it("navigates each level, skips disabled actions, and restores the parent trigger", async () => {
  await act(() => root.render(<Example />));
  expect(document.activeElement).toBe(item("Details"));
  await key("ArrowDown");
  expect(document.activeElement).toBe(item("Playtime"));
  await key("ArrowRight");
  expect(menus()).toHaveLength(2);
  expect(document.activeElement).toBe(item("Log session"));
  await key("End");
  expect(document.activeElement).toBe(item("Adjust total"));
  await key("ArrowDown");
  expect(document.activeElement).toBe(item("Log session"));
  await key("ArrowLeft");
  expect(menus()).toHaveLength(1);
  expect(document.activeElement).toBe(item("Playtime"));
  await key("a");
  expect(document.activeElement).toBe(item("Artwork"));
  expect(action).not.toHaveBeenCalled();
});

it("handles Escape one level at a time before allowing the enclosing dialog to close", async () => {
  await act(() => root.render(<Example />));
  await act(() => item("Playtime").click());
  expect(hasOpenContextMenu()).toBe(true);
  await key("Escape");
  expect(menus()).toHaveLength(1);
  expect(closed).not.toHaveBeenCalled();
  expect(dialogClosed).not.toHaveBeenCalled();
  await key("Escape");
  expect(menus()).toHaveLength(0);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(dialogClosed).not.toHaveBeenCalled();
  expect(hasOpenContextMenu()).toBe(false);
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(dialogClosed).toHaveBeenCalledTimes(1);
});

it("allows a flyout action to run before closing instead of treating it as an outside click", async () => {
  await act(() => root.render(<Example />));
  await act(() => item("Playtime").click());
  const target = item("Log session");
  await act(() =>
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
  );
  expect(menus()).toHaveLength(2);
  expect(closed).not.toHaveBeenCalled();
  await act(() => target.click());
  expect(action).toHaveBeenCalledTimes(1);
  expect(menus()).toHaveLength(0);
});

it("opens only one sibling flyout and dismisses the whole tree on an outside click", async () => {
  await act(() => root.render(<Example />));
  await act(() => item("Playtime").click());
  await act(() => item("Artwork").click());
  expect(menus()).toHaveLength(2);
  expect(item("Log session")).toBeUndefined();
  expect(item("Choose artwork")).toBeDefined();
  await act(() =>
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
  );
  expect(menus()).toHaveLength(0);
  expect(closed).toHaveBeenCalledTimes(1);
});

it("flips flyouts left near the right edge and keeps both panels inside the viewport", async () => {
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 300);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("aria-haspopup"))
        return new DOMRect(591, 220, 198, 32);
      return new DOMRect(0, 0, 200, 180);
    },
  );
  await act(() => root.render(<Example position={{ x: 795, y: 290 }} />));
  const parent = menus()[0] as HTMLElement;
  expect(parent.style.left).toBe("592px");
  expect(parent.style.top).toBe("112px");
  await act(() => item("Playtime").click());
  const child = menus()[1] as HTMLElement;
  expect(child.style.left).toBe("392px");
  expect(child.style.top).toBe("112px");
});
