// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { EditSessionDialog } from "./SessionChangeDialogs";

let root: Root;
let container: HTMLDivElement;

// 20:00 to 21:00 local time, two days ago.
const startMs = (() => {
  const date = new Date();
  date.setDate(date.getDate() - 2);
  date.setHours(20, 0, 0, 0);
  return date.getTime();
})();
const session: Session = {
  id: 5,
  gameId: -1,
  source: "custom",
  gameName: "Hollow Knight",
  exeName: "hollow_knight.exe",
  startedAt: new Date(startMs).toISOString(),
  endedAt: new Date(startMs + 3_600_000).toISOString(),
  durationSeconds: 3600,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

const onConfirm = vi.fn();

async function renderDialog(
  overlapFor: (times: {
    startMs: number;
    endMs: number;
  }) => Session | undefined = () => undefined,
) {
  onConfirm.mockClear();
  await act(() =>
    root.render(
      <EditSessionDialog
        session={session}
        gameName="Hollow Knight"
        coverUrl=""
        showDurationDays={false}
        onCancel={() => {}}
        overlapFor={overlapFor}
        onConfirm={onConfirm}
      />,
    ),
  );
}

// Started hours, Started minutes, Ended hours, Ended minutes, Length h, m.
const drums = () => [
  ...document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]'),
];

async function press(drum: HTMLInputElement, key: string) {
  await act(() =>
    drum.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  );
}

async function type(drum: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(drum, value);
    drum.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("fills in the length when the start moves", async () => {
  await renderDialog();
  await press(drums()[0]!, "ArrowDown");
  expect(drums().map((drum) => drum.value)).toEqual([
    "19",
    "00",
    "21",
    "00",
    "02",
    "00",
  ]);
});

it("does not step the start onto the end", async () => {
  await renderDialog();
  await press(drums()[0]!, "ArrowUp");
  expect(drums()[0]!.value).toBe("20");
  expect(document.body.textContent).not.toContain(
    "The end must be after the start.",
  );
  expect(document.body.textContent).toContain(
    "Stops here: a session needs at least one minute.",
  );
  // One minute before the end still works.
  for (let minute = 0; minute < 59; minute++)
    await press(drums()[1]!, "ArrowUp");
  expect(drums()[1]!.value).toBe("59");
  await press(drums()[1]!, "ArrowUp");
  expect(drums()[1]!.value).toBe("59");
});

it("does not step the length under a minute", async () => {
  await renderDialog();
  // 1h 00m: one hour less would leave nothing.
  await press(drums()[4]!, "ArrowDown");
  expect(drums()[4]!.value).toBe("01");
  // 0h 01m: one minute less would leave nothing.
  await type(drums()[4]!, "0");
  await type(drums()[5]!, "1");
  await press(drums()[5]!, "ArrowDown");
  expect(drums()[5]!.value).toBe("01");
  expect(document.body.textContent).toContain(
    "Stops here: a session needs at least one minute.",
  );
});

it("still lets typing cause a problem, and says why", async () => {
  await renderDialog();
  await type(drums()[0]!, "22");
  expect(document.body.textContent).toContain(
    "The end must be after the start.",
  );
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save",
  )!;
  expect(save.disabled).toBe(true);
});

it("says why the end stops at the game's next session, until the next change", async () => {
  // The next session of the game starts at 21:13.
  const nextStartMs = startMs + 73 * 60_000;
  const next: Session = {
    ...session,
    id: 6,
    startedAt: new Date(nextStartMs).toISOString(),
    endedAt: new Date(nextStartMs + 3_600_000).toISOString(),
  };
  await renderDialog((times) =>
    times.startMs < nextStartMs + 3_600_000 && times.endMs > nextStartMs
      ? next
      : undefined,
  );
  // Ended minutes: 21:00 up to 21:13 is fine, 21:14 would overlap.
  for (let minute = 0; minute < 14; minute++)
    await press(drums()[3]!, "ArrowUp");
  expect(drums()[3]!.value).toBe("13");
  expect(document.body.textContent).toMatch(
    /Stops here: your next session of this game starts at .+\. Combine them instead\./,
  );

  await press(drums()[3]!, "ArrowDown");
  expect(drums()[3]!.value).toBe("12");
  expect(document.body.textContent).not.toContain("Stops here");
});

it("picks a box by clicking it, and the other one fills in", async () => {
  await renderDialog();
  const box = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="group"]')].find(
      (group) => group.textContent?.startsWith(label),
    )!;
  // Started and Ended are picked; clicking Length drops Ended.
  await act(() => box("Length").click());
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save",
  )!;
  expect(save.disabled).toBe(true);

  await press(drums()[0]!, "ArrowDown");
  expect(drums().map((drum) => drum.value)).toEqual([
    "19",
    "00",
    "20",
    "00",
    "01",
    "00",
  ]);
});

it("stops the length hours at 0 without a hint", async () => {
  await renderDialog();
  // 0h 40m: no hour left to take away, but nothing wrong either.
  await type(drums()[4]!, "0");
  await type(drums()[5]!, "40");
  await press(drums()[4]!, "ArrowDown");
  expect(drums()[5]!.value).toBe("40");
  expect(document.body.textContent).not.toContain("Stops here");
  expect(document.body.textContent).not.toContain(
    "A session needs at least one minute.",
  );
});
