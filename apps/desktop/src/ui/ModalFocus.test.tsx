// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "./primitives";

/* A dialog hands focus back to what had it before it opened. Y opens a
   game's Details from its card, and the controller puts its ring on the
   dialog's first tab in the very frame the dialog shows, before the
   dialog's passive effects run. In development StrictMode also runs the
   dialog's effects twice, the second time with focus already inside. The
   dialog must still remember the card. */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Moves focus into the dialog during the commit, like the controller's
 *  ring does before the dialog's own effects get their turn. */
function FocusIntoDialog() {
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("#first-tab")?.focus();
  }, []);
  return null;
}

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button id="card" type="button">
        Celeste
      </button>
      {open ? (
        <Modal labelId="details-title" title="Celeste" onClose={() => {}}>
          <button id="first-tab" type="button" data-autofocus>
            General
          </button>
        </Modal>
      ) : null}
      {open ? <FocusIntoDialog /> : null}
    </>
  );
}

it.each([
  ["", false],
  [" in StrictMode", true],
])(
  "gives focus back to the card that opened it, even when focus moved into it first%s",
  async (_, strict) => {
    const show = (open: boolean) =>
      strict ? (
        <StrictMode>
          <Harness open={open} />
        </StrictMode>
      ) : (
        <Harness open={open} />
      );
    await act(() => root.render(show(false)));
    document.querySelector<HTMLElement>("#card")!.focus();

    await act(() => root.render(show(true)));
    expect(document.activeElement?.id).toBe("first-tab");

    await act(() => root.render(show(false)));
    // The hand-back waits a frame.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement?.id).toBe("card");
  },
);
