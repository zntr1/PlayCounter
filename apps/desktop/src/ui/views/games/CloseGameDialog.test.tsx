// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../tracker", () => ({ closeRunningGame: vi.fn() }));

import type { ActiveSession } from "../../../store";
import { closeRunningGame } from "../../../tracker";
import { CloseGameDialog } from "./CloseGameDialog";

const session = (id: number, gameName: string): ActiveSession => ({
  id,
  gameId: id,
  gameName,
  exeName: `${gameName}.exe`,
  coverUrl: "",
  source: "custom",
  startedAt: "2026-10-24T10:00:00.000Z",
  checkpointedAt: "2026-10-24T10:00:00.000Z",
});

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onStart = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(sessions: ActiveSession[], nextGameName?: string) {
  await act(() =>
    root.render(
      createElement(CloseGameDialog, {
        sessions,
        nextGameName,
        onStart: nextGameName ? onStart : undefined,
        onClose,
      }),
    ),
  );
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
}

async function click(text: string) {
  await act(async () => button(text)!.click());
}

it("asks first with Cancel focused, then closes the game", async () => {
  vi.mocked(closeRunningGame).mockResolvedValue("closed");
  await render([session(1, "Hades")]);
  expect(document.body.textContent).toContain("Close Hades?");
  expect(document.activeElement).toBe(button("Cancel"));
  expect(closeRunningGame).not.toHaveBeenCalled();

  await click("Close game");
  expect(closeRunningGame).toHaveBeenCalledWith(1, false);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("offers Force close when the game is still running, and explains a refusal", async () => {
  vi.mocked(closeRunningGame)
    .mockResolvedValueOnce("stillRunning")
    .mockResolvedValueOnce("blocked");
  await render([session(1, "Hades")]);

  await click("Close game");
  expect(document.body.textContent).toContain("Hades is still running");
  expect(document.activeElement).toBe(button("Cancel"));

  await click("Force close");
  expect(closeRunningGame).toHaveBeenLastCalledWith(1, true);
  expect(document.body.textContent).toContain("PlayCounter can't close Hades");
  expect(document.activeElement).toBe(button("OK"));
  expect(onClose).not.toHaveBeenCalled();
});

it("closes every running game before it starts the next one", async () => {
  vi.mocked(closeRunningGame).mockResolvedValue("closed");
  await render([session(1, "Hades"), session(2, "Celeste")], "Zelda");
  expect(document.body.textContent).toContain("2 games are running");

  await click("Close 2 games and start Zelda");
  expect(vi.mocked(closeRunningGame).mock.calls).toEqual([
    [1, false],
    [2, false],
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onStart).toHaveBeenCalledTimes(1);
});

it("starts the next game next to the running one, or not at all", async () => {
  await render([session(1, "Hades")], "Zelda");
  await click("Start Zelda anyway");
  expect(closeRunningGame).not.toHaveBeenCalled();
  expect(onStart).toHaveBeenCalledTimes(1);

  onStart.mockClear();
  await render([session(1, "Hades")], "Zelda");
  await click("Cancel");
  expect(onStart).not.toHaveBeenCalled();
});

it("does not start the next game when a running one refuses to close", async () => {
  vi.mocked(closeRunningGame).mockResolvedValue("blocked");
  await render([session(1, "Hades")], "Zelda");
  await click("Close Hades and start Zelda");
  expect(document.body.textContent).toContain("PlayCounter can't close Hades");
  expect(onStart).not.toHaveBeenCalled();
});
