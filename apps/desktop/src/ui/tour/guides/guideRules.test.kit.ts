import { expect } from "vitest";
import type { TourDefinition, TourStep } from "../tourTypes";

/* The rules every step follows (docs/tours-plan.md, section 2), as checks a
   guide's own test file runs on its guide. */

/** Every English text the app can show, from all area files. */
const englishTexts = new Set(
  Object.values(
    import.meta.glob<Record<string, string>>("../../../locales/en/*.json", {
      eager: true,
      import: "default",
    }),
  ).flatMap((area) => Object.values(area)),
);

export const boldNames = (text: string | undefined) =>
  [...(text ?? "").matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

export const stepOf = (guide: TourDefinition, id: string): TourStep => {
  const step = guide.steps.find((candidate) => candidate.id === id);
  // i18n-exempt: a test helper's own error.
  if (!step) throw new Error(`${guide.id} has no step "${id}"`);
  return step;
};

export const indexOf = (guide: TourDefinition, id: string) =>
  guide.steps.findIndex((step) => step.id === id);

export function expectStepRules(guide: TourDefinition) {
  expect(guide.steps.length, "4 to 9 steps").toBeGreaterThanOrEqual(4);
  expect(guide.steps.length, "4 to 9 steps").toBeLessThanOrEqual(9);
  for (const step of guide.steps) {
    const at = `${guide.id}/${step.id}`;
    expect(step.title.length, `${at} title`).toBeLessThanOrEqual(40);
    expect(step.body.length, `${at} body`).toBeLessThanOrEqual(220);
    expect(step.task?.length ?? 0, `${at} task`).toBeLessThanOrEqual(160);
    // No step on a dark empty screen.
    expect(step.anchor, `${at} rings something`).toBeTruthy();
    expect(`${step.title} ${step.body} ${step.task ?? ""}`, at).not.toMatch(
      /\b(providers?|wizard|executables?)\b/i,
    );
    // A control is named exactly as the app shows it.
    for (const name of [...boldNames(step.body), ...boldNames(step.task)])
      expect(englishTexts.has(name), `${at} names "${name}"`).toBe(true);
    if (step.task) {
      // A task finishes by itself, and can be stepped over.
      expect(step.interactive, `${at} interactive`).toBe(true);
      expect(step.advanceOn, `${at} advanceOn`).toBeTruthy();
      expect(step.allow?.length, `${at} allow`).toBeGreaterThan(0);
    }
  }
  // "This is a sample, nothing is saved" is said once, in the first step.
  const saysSample = (step: TourStep) =>
    /sample/i.test(step.body) && /nothing is (saved|sent)/i.test(step.body);
  expect(saysSample(guide.steps[0]), "first step says it is a sample").toBe(
    true,
  );
  expect(
    guide.steps
      .slice(1)
      .filter((step) =>
        /nothing is saved/i.test(`${step.body} ${step.task ?? ""}`),
      )
      .map((step) => step.id),
    "said once only",
  ).toEqual([]);
  // The last step is for reading: what to do in the real app.
  expect(guide.steps.at(-1)?.task, "last step has no task").toBeUndefined();
  expect(guide.steps.at(-1)?.body, "last step: the real app").toMatch(
    /in the app/i,
  );
}
