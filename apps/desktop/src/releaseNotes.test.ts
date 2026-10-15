import { describe, expect, it } from "vitest";
import {
  MAX_RELEASE_NOTE_HEADLINE_LENGTH,
  MAX_RELEASE_NOTE_HIGHLIGHTS,
  MAX_RELEASE_NOTE_LINE_LENGTH,
  decideReleaseNotesDisplay,
  findReleaseNote,
  findUnseenReleaseNotes,
  parseManifestNotes,
  sanitizeReleaseNotes,
  sanitizeTranslatedNotes,
  toDisplayNotes,
  updateDisplayNotes,
  type ReleaseNote,
} from "./releaseNotes";

const notes: ReleaseNote[] = [
  {
    version: "1.2.0",
    headline: "A friendlier update",
    highlights: ["The important change"],
  },
];

describe("release note catalog", () => {
  it("sanitizes, bounds, and rejects invalid entries", () => {
    const result = sanitizeReleaseNotes([
      null,
      { version: "", headline: "Missing version" },
      { version: "1.0.0", headline: "" },
      {
        version: "v1.2.0",
        releasedAt: "2026-08-21",
        headline: `Hello\u0000${"!".repeat(400)}`,
        highlights: Array.from(
          { length: 20 },
          (_, index) => `${index}\u0007${"x".repeat(800)}`,
        ),
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("1.2.0");
    expect(result[0].headline).not.toContain("\u0000");
    expect(result[0].headline.length).toBeLessThanOrEqual(
      MAX_RELEASE_NOTE_HEADLINE_LENGTH,
    );
    expect(result[0].highlights).toHaveLength(MAX_RELEASE_NOTE_HIGHLIGHTS);
    expect(result[0].highlights[0]).not.toContain("\u0007");
    expect(result[0].highlights[0].length).toBeLessThanOrEqual(
      MAX_RELEASE_NOTE_LINE_LENGTH,
    );
    expect(sanitizeReleaseNotes({})).toEqual([]);
  });

  it("finds exact versions with or without a v prefix", () => {
    expect(findReleaseNote("v1.2.0", notes)?.headline).toBe(
      "A friendlier update",
    );
    expect(findReleaseNote("1.2.1", notes)).toBeNull();
    expect(findReleaseNote(null, notes)).toBeNull();
  });

  it("returns every unseen release through the installed version", () => {
    const history: ReleaseNote[] = [
      { version: "1.1.4", headline: "Old", highlights: ["Old"] },
      { version: "1.1.6", headline: "Newest", highlights: ["Newest"] },
      { version: "1.1.5", headline: "Middle", highlights: ["Middle"] },
      { version: "1.2.0", headline: "Future", highlights: ["Future"] },
    ];

    expect(
      findUnseenReleaseNotes("1.1.6", "1.1.4", history).map(
        (note) => note.version,
      ),
    ).toEqual(["1.1.6", "1.1.5"]);
    expect(findUnseenReleaseNotes("1.1.6", null, history)).toEqual([
      history[1],
    ]);
  });

  it("shows a release in the app's language, else in English", () => {
    const [note] = sanitizeReleaseNotes([
      {
        version: "1.2.0",
        headline: "English",
        highlights: ["One"],
        translations: {
          de: { headline: "Deutsch\u0007", highlights: ["Eins"] },
          it: { headline: "Italiano", highlights: ["Uno"] },
          en: { headline: "Not English", highlights: [] },
        },
      },
    ]);

    expect(Object.keys(note.translations ?? {})).toEqual(["de"]);
    expect(toDisplayNotes(note, "de")).toEqual({
      headline: "Deutsch",
      highlights: ["Eins"],
      paragraphs: [],
    });
    expect(toDisplayNotes(note, "en").headline).toBe("English");
    expect(
      toDisplayNotes({ ...note, translations: undefined }, "de").headline,
    ).toBe("English");
  });
});

describe("updater manifest notes", () => {
  it("keeps the headline, bullets, and prose in separate sections", () => {
    expect(
      parseManifestNotes(
        "# Easier to use\r\n• A clearer setup\r\n- Better updates\r\nMore details here.",
      ),
    ).toEqual({
      headline: "Easier to use",
      highlights: ["A clearer setup", "Better updates"],
      paragraphs: ["More details here."],
    });
  });

  it("handles empty, bullet-first, and prose-only notes", () => {
    expect(parseManifestNotes("  ")).toEqual({
      headline: null,
      highlights: [],
      paragraphs: [],
    });
    expect(parseManifestNotes("* First\n* Second")).toMatchObject({
      headline: null,
      highlights: ["First", "Second"],
    });
    expect(parseManifestNotes("Headline\nA paragraph")).toEqual({
      headline: "Headline",
      highlights: [],
      paragraphs: ["A paragraph"],
    });
  });

  it("uses the update's notes in the app's language, else English", () => {
    const translatedNotes = sanitizeTranslatedNotes({
      de: "Neu\n• Eins",
      it: "Nuovo\n• Uno",
      en: "Not English",
    });

    expect(translatedNotes).toEqual({ de: "Neu\n• Eins" });
    expect(
      updateDisplayNotes({ notes: "New\n• One", translatedNotes }, "de"),
    ).toMatchObject({ headline: "Neu", highlights: ["Eins"] });
    expect(updateDisplayNotes({ notes: "New\n• One" }, "de").headline).toBe(
      "New",
    );
    expect(sanitizeTranslatedNotes("de")).toBeUndefined();
    expect(sanitizeTranslatedNotes({ de: 42 })).toBeUndefined();
  });
});

describe("release note display decision", () => {
  it.each([
    [null, null, true, false, "wait"],
    ["1.2.0", "1.2.0", true, false, "wait"],
    ["1.2.0", null, false, false, "mark-seen"],
    ["1.2.0", null, true, true, "wait"],
    ["1.2.0", null, true, false, "show"],
    ["1.2.0", "1.1.0", true, false, "show"],
    ["9.9.9", "1.2.0", true, false, "mark-seen"],
  ])(
    "decides for version=%s seen=%s persisted=%s blocked=%s",
    (version, lastSeenVersion, hadPersistedState, blocked, action) => {
      expect(
        decideReleaseNotesDisplay(
          { version, lastSeenVersion, hadPersistedState, blocked },
          notes,
        ).action,
      ).toBe(action);
    },
  );

  it("includes intermediate versions in a show decision", () => {
    const history: ReleaseNote[] = [
      { version: "1.1.6", headline: "Newest", highlights: ["Newest"] },
      { version: "1.1.5", headline: "Middle", highlights: ["Middle"] },
    ];
    const decision = decideReleaseNotesDisplay(
      {
        version: "1.1.6",
        lastSeenVersion: "1.1.4",
        hadPersistedState: true,
        blocked: false,
      },
      history,
    );

    expect(decision.action).toBe("show");
    if (decision.action === "show") {
      expect(decision.notes.map((note) => note.version)).toEqual([
        "1.1.6",
        "1.1.5",
      ]);
    }
  });
});
