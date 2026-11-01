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
  toWhatsNew,
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
    expect((result[0].highlights[0] as string).length).toBeLessThanOrEqual(
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

describe("points with pictures (paged What's new)", () => {
  // Shaped like 1.5.0's entry: points with pictures become pages, the rest
  // goes to "Also new", and older entries keep plain lines.
  const [paged] = sanitizeReleaseNotes([
    {
      version: "1.5.0",
      headline: "See your achievements",
      highlights: [
        {
          title: "Your achievements, game by game",
          text: "See what you unlocked on Steam, Xbox and Epic Games.",
          hint: "Right-click a game in My Games → Achievements",
          image: "achievements",
        },
        { title: "Sign in once", text: "Kept sign-ins.", image: "accounts" },
        { title: "Less CPU", text: "About a sixth of the CPU." },
        "A line written the old way",
      ],
      translations: {
        de: {
          headline: "Sieh deine Erfolge",
          highlights: [
            {
              title: "Deine Erfolge, Spiel für Spiel",
              text: "Sieh, was du freigeschaltet hast.",
              hint: "Rechtsklick → „Erfolge“",
              // A translation never picks its own picture.
              image: "accounts",
            },
            { title: "Nur einmal anmelden", text: "Gespeicherte Anmeldungen." },
            { title: "Weniger CPU", text: "Etwa ein Sechstel der CPU." },
            "Eine Zeile wie früher",
          ],
        },
      },
    },
  ]);
  const images = {
    "1.5.0/achievements": "/assets/achievements.webp",
    "1.5.0/accounts": "/assets/accounts.webp",
  };

  it("reads a point as title, text, hint and picture, and plain lines still", () => {
    expect(paged.highlights).toEqual([
      {
        title: "Your achievements, game by game",
        text: "See what you unlocked on Steam, Xbox and Epic Games.",
        hint: "Right-click a game in My Games → Achievements",
        image: "achievements",
      },
      { title: "Sign in once", text: "Kept sign-ins.", image: "accounts" },
      { title: "Less CPU", text: "About a sixth of the CPU." },
      "A line written the old way",
    ]);
  });

  it("drops points without a title or text, and pictures that are no plain name", () => {
    const [note] = sanitizeReleaseNotes([
      {
        version: "1.5.0",
        headline: "Headline",
        highlights: [
          { title: "", text: "No title" },
          { title: "No text", text: " " },
          { title: "Bad picture", text: "Text", image: "../secret" },
          { title: 5, text: "Wrong type" },
        ],
      },
    ]);
    expect(note.highlights).toEqual([{ title: "Bad picture", text: "Text" }]);
  });

  it("gives every point with a picture its own page, in order, and the rest to Also new", () => {
    const view = toWhatsNew(paged, "en", images);
    expect(view.version).toBe("1.5.0");
    expect(view.headline).toBe("See your achievements");
    expect(view.pages).toEqual([
      {
        title: "Your achievements, game by game",
        text: "See what you unlocked on Steam, Xbox and Epic Games.",
        hint: "Right-click a game in My Games → Achievements",
        imageUrl: "/assets/achievements.webp",
      },
      {
        title: "Sign in once",
        text: "Kept sign-ins.",
        imageUrl: "/assets/accounts.webp",
      },
    ]);
    expect(view.more).toEqual([
      { title: "Less CPU", text: "About a sixth of the CPU." },
      { text: "A line written the old way" },
    ]);
  });

  it("shows a translation with the English picture", () => {
    const view = toWhatsNew(paged, "de", images);
    expect(view.headline).toBe("Sieh deine Erfolge");
    expect(view.pages.map((page) => [page.title, page.imageUrl])).toEqual([
      ["Deine Erfolge, Spiel für Spiel", "/assets/achievements.webp"],
      ["Nur einmal anmelden", "/assets/accounts.webp"],
    ]);
    expect(view.pages[0].hint).toBe("Rechtsklick → „Erfolge“");
    expect(view.more).toEqual([
      { title: "Weniger CPU", text: "Etwa ein Sechstel der CPU." },
      { text: "Eine Zeile wie früher" },
    ]);
  });

  it("keeps a page whose picture file is missing, without the picture", () => {
    const view = toWhatsNew(paged, "en", {});
    expect(view.pages.map((page) => [page.title, page.imageUrl])).toEqual([
      ["Your achievements, game by game", undefined],
      ["Sign in once", undefined],
    ]);
  });

  it("gives a version written the old way no pages", () => {
    const view = toWhatsNew(notes[0], "en", images);
    expect(view.pages).toEqual([]);
    expect(view.more).toEqual([{ text: "The important change" }]);
  });

  it("lists a point as one line where a list is shown", () => {
    expect(toDisplayNotes(paged, "en").highlights).toEqual([
      "Your achievements, game by game: See what you unlocked on Steam, Xbox and Epic Games.",
      "Sign in once: Kept sign-ins.",
      "Less CPU: About a sixth of the CPU.",
      "A line written the old way",
    ]);
  });
});
