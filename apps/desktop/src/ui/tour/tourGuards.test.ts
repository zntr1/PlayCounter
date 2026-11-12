import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tours, type TourStep } from "./tourDefinitions";

/* Guards that keep the guides in step with the app (docs/tours-plan.md).
   - A ring target a guide names must still be rendered somewhere.
   - A step text stays short.
   - Guides use the app's own words. */

const src = fileURLToPath(new URL("../..", import.meta.url));
const tourDir = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "locales" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [full]
      : [];
  });
}

// What the app renders. The guide definitions only name targets, and so does
// every `[data-tour="…"]` selector, so both are left out.
const rendered = sourceFiles(src)
  .filter((file) => !file.startsWith(join(tourDir, "guides")))
  .map((file) =>
    readFileSync(file, "utf8").replace(/\[data-tour="[^"\]]*"\]/g, ""),
  );

const stepSelectors = (step: TourStep) => [
  step.anchor,
  step.positionAnchor,
  step.retreatWhenMissing,
  step.advanceOn?.type === "anchor-present"
    ? step.advanceOn.selector
    : undefined,
  ...(step.anchorTargets ?? []),
  ...(step.additionalAnchors ?? []),
  ...(step.allow ?? []),
];

const tourNames = (selector: string | undefined) =>
  [...(selector ?? "").matchAll(/data-tour="([^"]+)"/g)].map(
    (match) => match[1],
  );

/** Names no source renders: neither written out ("demo-journal") nor built
 *  from a prefix (`nav-${item}`). A built name is only checked by its prefix,
 *  so this cannot tell whether `nav-history` is a real sidebar item. */
export function unrenderedTourNames(names: string[], sources: string[]) {
  return names.filter((name) => {
    if (
      sources.some(
        (text) =>
          text.includes(`"${name}"`) ||
          text.includes(`'${name}'`) ||
          text.includes(`\`${name}\``),
      )
    )
      return false;
    const parts = name.split("-");
    for (let cut = parts.length - 1; cut > 0; cut -= 1) {
      const prefix = `${parts.slice(0, cut).join("-")}-\${`;
      if (sources.some((text) => text.includes(prefix))) return false;
    }
    return true;
  });
}

describe("guide files", () => {
  it("are all in the Help menu's list", () => {
    const guideFiles = readdirSync(join(tourDir, "guides")).filter(
      (file) => !/\.test\.|^shared\.ts$/.test(file),
    );
    const index = readFileSync(join(tourDir, "tourDefinitions.ts"), "utf8");
    expect(
      guideFiles.filter(
        (file) => !index.includes(`"./guides/${file.replace(/\.ts$/, "")}"`),
      ),
    ).toEqual([]);
    expect(tours()).toHaveLength(guideFiles.length);
  });
});

describe("guide ring targets", () => {
  it("finds a written-out name, a built name, and misses a removed one", () => {
    const sources = [
      '<div data-tour="demo-journal" />',
      "<a data-tour={`nav-${item}`} />",
      // A selector alone renders nothing.
      'document.querySelector("")',
    ];
    expect(
      unrenderedTourNames(
        ["demo-journal", "nav-history", "demo-removed", "settings-gone"],
        sources,
      ),
    ).toEqual(["demo-removed", "settings-gone"]);
  });

  it("only names targets the app still renders", () => {
    const problems = tours().flatMap((tour) =>
      tour.steps.flatMap((step) =>
        unrenderedTourNames(
          [...new Set(stepSelectors(step).flatMap(tourNames))],
          rendered,
        ).map((name) => `${tour.id}/${step.id}: ${name}`),
      ),
    );
    expect(problems).toEqual([]);
  });
});

/* Step texts ──────────────────────────────────────────────────────────────
   One thing per step: a text has at most BODY_LIMIT characters in English.
   TOO_LONG lists the steps written before this rule. A step leaves the list
   when its text is rewritten; nothing may be added. */

const BODY_LIMIT = 220;

const TOO_LONG = new Set<string>([]);

// "provider" is "launcher" in the app; the Discovered "wizard" is its review.
const NOT_OUR_WORDS = /\b(providers?|wizard)\b/i;

const OLD_WORDS = new Set<string>([]);

describe("guide texts", () => {
  const steps = tours().flatMap((tour) =>
    tour.steps.map((step) => ({ id: `${tour.id}/${step.id}`, step })),
  );
  const ratchet = (failing: string[], known: Set<string>) => ({
    new: failing.filter((id) => !known.has(id)),
    fixed: [...known].filter((id) => !failing.includes(id)),
  });

  it(`keeps every step text within ${BODY_LIMIT} characters`, () => {
    const long = steps
      .filter(({ step }) => step.body.length > BODY_LIMIT)
      .map(({ id }) => id);
    // "fixed" entries are done: take them off TOO_LONG.
    expect(ratchet(long, TOO_LONG)).toEqual({ new: [], fixed: [] });
  });

  it("uses the app's words", () => {
    const old = steps
      .filter(({ step }) => NOT_OUR_WORDS.test(`${step.title} ${step.body}`))
      .map(({ id }) => id);
    expect(ratchet(old, OLD_WORDS)).toEqual({ new: [], fixed: [] });
  });
});
