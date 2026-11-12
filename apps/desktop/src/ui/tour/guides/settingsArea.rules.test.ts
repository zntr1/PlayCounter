import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../platform", () => ({
  currentPlatform: () => "windows",
  detectPlatformFrom: () => "windows",
}));

import { tours } from "../tourDefinitions";
import { NEXT_RELEASE } from "./shared";

/* The rules of docs/tours-plan.md (section 2) and of the agents' brief, for
   the five guides around Settings: Personalize PlayCounter, Back up or move
   your data, Watch folders for new games, Find replies to your feedback and
   While you play. */

const GUIDES = {
  settings: 5,
  "backup-data": 4,
  "watch-folders": 2,
  "feedback-replies": 3,
  "while-you-play": 1,
} as const;

const guide = (id: string) => tours().find((tour) => tour.id === id)!;
const mine = () => Object.keys(GUIDES).map(guide);
const steps = () =>
  mine().flatMap((tour) =>
    tour.steps.map((step) => ({ id: `${tour.id}/${step.id}`, step })),
  );
const texts = (step: { title: string; body: string; task?: string }) =>
  `${step.title} ${step.body} ${step.task ?? ""}`;
const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

const enDir = fileURLToPath(new URL("../../../locales/en", import.meta.url));
const english = new Set(
  readdirSync(enDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) =>
      Object.values(
        JSON.parse(readFileSync(join(enDir, file), "utf8")) as Record<
          string,
          string
        >,
      ),
    ),
);

describe("the guides around Settings follow the rules", () => {
  it("carry the next version and the next release", () => {
    for (const [id, version] of Object.entries(GUIDES)) {
      expect(guide(id).version, id).toBe(version);
      expect(guide(id).release, id).toBe(NEXT_RELEASE);
    }
  });

  it("have 4 to 9 steps", () => {
    for (const tour of mine()) {
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(4);
      expect(tour.steps.length, tour.id).toBeLessThanOrEqual(9);
    }
  });

  it("keep titles to 40, texts to 220 and tasks to 160 characters", () => {
    const long = steps().flatMap(({ id, step }) => [
      ...(step.title.length > 40 ? [`${id} title ${step.title.length}`] : []),
      ...(step.body.length > 220 ? [`${id} body ${step.body.length}`] : []),
      ...((step.task?.length ?? 0) > 160
        ? [`${id} task ${step.task!.length}`]
        : []),
    ]);
    expect(long).toEqual([]);
  });

  it("ring something on every step, the first one included", () => {
    expect(
      steps()
        .filter(({ step }) => !step.anchor)
        .map(({ id }) => id),
    ).toEqual([]);
  });

  it("name controls the way the app writes them", () => {
    const unknown = steps().flatMap(({ id, step }) =>
      bold(texts(step))
        .filter((label) => !english.has(label))
        .map((label) => `${id}: ${label}`),
    );
    expect(unknown).toEqual([]);
  });

  it("use the app's words", () => {
    const old = steps()
      .filter(({ step }) =>
        /\b(providers?|wizard|checkbox|executables?)\b/i.test(texts(step)),
      )
      .map(({ id }) => id);
    expect(old).toEqual([]);
  });

  it("never suggest a key: the player picks every hotkey", () => {
    const keys = steps()
      .filter(({ step }) =>
        /<kbd>|\b(Ctrl|Alt|Shift|Win|Cmd|F\d{1,2})\b/.test(texts(step)),
      )
      .map(({ id }) => id);
    expect(keys).toEqual([]);
  });

  it("quote other guides by their real title", () => {
    const titles = new Set(tours().map((tour) => tour.title));
    const wrong = steps().flatMap(({ id, step }) =>
      [...step.body.matchAll(/“([^”]+)”/g)]
        .map((match) => match[1])
        .filter((title) => !titles.has(title))
        .map((title) => `${id}: ${title}`),
    );
    expect(wrong).toEqual([]);
  });

  it("finish a task by itself and still let the player step over it", () => {
    for (const { id, step } of steps().filter(({ step }) => step.task)) {
      expect(step.interactive, id).toBe(true);
      expect(step.allow?.length, id).toBeGreaterThan(0);
      expect(step.advanceOn?.type, id).toBe("event");
      // Stepped over with "Skip step", without dragging later steps along.
      expect(step.manualAdvance, id).toBe(true);
    }
  });

  it("lead on to a guide that exists", () => {
    for (const tour of mine())
      if (tour.nextTourId)
        expect(guide(tour.nextTourId), tour.id).toBeDefined();
  });
});

describe("Personalize PlayCounter", () => {
  const step = (id: string) =>
    guide("settings").steps.find((entry) => entry.id === id)!;

  it("says once, at the start, that changes here are real", () => {
    const [first, ...rest] = guide("settings").steps;
    expect(first.body).toMatch(/real settings/);
    expect(first.body).toMatch(/saved/);
    expect(rest.filter((entry) => /\breal\b/.test(entry.body))).toEqual([]);
  });

  it("has a step for the search and one for While you play", () => {
    expect(
      guide("settings").steps.some((entry) =>
        entry.anchor?.includes("settings-search"),
      ),
    ).toBe(true);
    expect(step("play").settingsGroup).toBe("play");
    expect(step("play").body).toContain("“While you play”");
  });

  it("no longer counts three hotkeys, and leaves the keys to the player", () => {
    expect(step("shortcuts").body).not.toMatch(/All three/);
    expect(step("shortcuts").body).toMatch(/keys you want/);
  });

  it("mentions Start page and Language on the General page", () => {
    expect(bold(step("general").body)).toEqual(
      expect.arrayContaining(["Launch on startup", "Start page", "Language"]),
    );
  });

  it("covers both switches of Discovery under their own names", () => {
    expect(step("sharing").title).not.toBe("Help improve detection");
    expect(bold(step("sharing").body)).toEqual([
      "Track software",
      "Share apps you ignore",
    ]);
  });

  it("keeps launching to the two settings that matter and its guide", () => {
    expect(bold(step("launcher").body)).toEqual([
      "Remember launch paths",
      "Launch games directly",
    ]);
    expect(step("launcher").body).toContain("“Launch games directly”");
  });

  it("names the popup monitor and the choices that need review", () => {
    expect(step("notifications").body).toContain("<b>Popup monitor</b>");
    expect(step("notifications").body).toMatch(/choices that need review/i);
  });

  it("calls the update button Check", () => {
    expect(step("updates").body).toContain("<b>Check</b>");
    expect(step("updates").body).not.toContain("Check for updates");
  });

  it("lists no emulator names", () => {
    for (const entry of guide("settings").steps)
      expect(entry.body).not.toMatch(/Dolphin|PCSX2|DOSBox/);
  });

  it("marks every step whose controls can be changed as real settings", () => {
    for (const entry of guide("settings").steps.filter(
      (candidate) => candidate.interactive,
    )) {
      expect(entry.persistentInteraction, entry.id).toBe(true);
      expect(entry.manualAdvance, entry.id).toBe(true);
    }
  });
});

describe("Back up or move your data", () => {
  const all = () => guide("backup-data").steps;

  it("only points: no step lets the player click", () => {
    expect(all().filter((entry) => entry.interactive)).toEqual([]);
  });

  it("says in one sentence what a backup leaves on this PC", () => {
    const stays = all().filter((entry) => /launch paths/.test(entry.body));
    expect(stays).toHaveLength(1);
    expect(stays[0].body).toMatch(/ignored apps/);
    expect(stays[0].body).toMatch(/watched folders/);
    expect(stays[0].body).toMatch(/sign-ins/);
  });

  it("shows the Reset section", () => {
    const reset = all().find((entry) => entry.id === "reset")!;
    expect(bold(reset.body)).toEqual(
      expect.arrayContaining(["Restore default settings", "Start over"]),
    );
  });
});

describe("Watch folders for new games", () => {
  const step = (id: string) =>
    guide("watch-folders").steps.find((entry) => entry.id === id)!;

  it("tells when PlayCounter looks apart from what happens to a folder", () => {
    expect(step("when").body).toMatch(/starts/);
    expect(step("when").body).not.toMatch(/Discovered/);
    expect(step("results").body).toMatch(/Discovered/);
    expect(step("results").body).not.toMatch(/starts/);
  });

  it("counts PlayStation among the games that join by themselves", () => {
    expect(step("auto-add").body).toMatch(/PlayStation/);
    expect(step("auto-add").body).toMatch(/Xbox/);
  });

  it("only points: no step lets the player click", () => {
    expect(
      guide("watch-folders").steps.filter((entry) => entry.interactive),
    ).toEqual([]);
  });
});

describe("Find replies to your feedback", () => {
  it("offers what the feedback dialog offers: no questions", () => {
    for (const entry of guide("feedback-replies").steps)
      expect(entry.body).not.toMatch(/ask a question/);
    expect(guide("feedback-replies").steps[0].body).toMatch(/bug/);
    expect(guide("feedback-replies").steps[0].body).toMatch(/feature/);
  });

  it("draws one ring per step", () => {
    for (const entry of guide("feedback-replies").steps)
      expect(entry.additionalAnchors ?? [], entry.id).toEqual([]);
  });

  it("only points: no step lets the player click", () => {
    expect(
      guide("feedback-replies").steps.filter((entry) => entry.interactive),
    ).toEqual([]);
  });
});

describe("While you play", () => {
  it("goes from the sample game to the settings and back to the player", () => {
    expect(guide("while-you-play").steps.map((entry) => entry.id)).toEqual([
      "intro",
      "pause",
      "stop",
      "timer",
      "corner",
      "reminder",
      "keys",
      "finish",
    ]);
  });

  it("says once, in the first step, that the game is a sample", () => {
    const [first, ...rest] = guide("while-you-play").steps;
    expect(first.body).toMatch(/sample/);
    expect(first.body).toMatch(/nothing here is saved/i);
    expect(
      rest.filter((entry) => /nothing .* saved/i.test(entry.body)),
    ).toEqual([]);
  });

  it("asks for Pause and Resume, and for Stop", () => {
    const step = (id: string) =>
      guide("while-you-play").steps.find((entry) => entry.id === id)!;
    expect(bold(step("pause").task!)).toEqual(["Pause", "Resume"]);
    expect(bold(step("stop").task!)).toEqual(["Stop"]);
  });

  it("only points at the real settings", () => {
    for (const entry of guide("while-you-play").steps.filter(
      (candidate) => candidate.view === "settings",
    ))
      expect(entry.interactive, entry.id).toBeUndefined();
  });
});
