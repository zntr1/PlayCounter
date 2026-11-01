# Release notes

Desktop release notes live in `apps/desktop/src/releaseNotes.json`. Add an entry in
the same change that bumps the desktop version — the version-sync check fails a
release that has no usable entry for its version.

Write for people who use PlayCounter, not for the people who build it:

- Start with one short headline that says why the update is worth having.
- Add a few concise highlights and put the most important one first.
- Say what changed for the user. Skip commit messages, internal names, and
  implementation details.
- Keep the newest version at the top, and never rewrite notes for a release that
  is already published (adding a missing translation is fine).

The desktop app bundles this catalog and shows the notes once after an update.
The release scripts also copy the current entry into Tauri's `latest.json`, so an
older installed app can show what is coming before you install it.

## Points: title, text, hint, picture

From 1.5.0 on, "What's new" shows one feature per page with a picture. Each
point is an object:

```json
{
  "title": "Your achievements, game by game",
  "text": "See what you unlocked on Steam, Xbox and Epic Games, when you got it and what's still missing.",
  "hint": "Right-click a game in My Games → Achievements",
  "image": "achievements"
}
```

- `title`: up to five words or so (80 characters at most).
- `text`: one or two sentences.
- `hint`: where to find it, with the names the app shows. Only when the
  feature isn't easy to find (120 characters at most).
- `image`: a picture's file name in `apps/desktop/src/assets/whats-new/<version>/`,
  without `.webp`. Only on the English point; translations show the same picture.
- Points with a picture become the pages, in their order. Points without one
  are listed on "Also new". Put the big features first, with pictures, and the
  small ones and the fixes last, without.
- Entries up to 1.4.3 keep their points as plain lines; the app still shows them
  as a list. Don't convert old entries.

`latest.json` turns each point into one line, `• Title: text`, so older
installed apps read the shorter text in "Update available". Hints and pictures
only exist in the app.

## Pictures

- Real screenshots of the release, with sample games only: never a real
  library, account or name.
- WebP, 2:1, 1600 px wide, quality 80. Most are 30–60 KB; screens full of game
  covers come out around 120 KB. They ship inside the installer.
- English UI in every language.
- `docs/whats-new/capture.cjs` (local, like `docs/landing-screenshots`) takes
  them from the running dev server (`pnpm desktop:dev`) with a sample library,
  then ffmpeg converts:
  `ffmpeg -i out/<name>.png -vf scale=1600:-2 -c:v libwebp -quality 80 <name>.webp`.
- The translation guard fails when a point names a picture that isn't there.
  Pictures of old releases can go later, together with their `image` keys.

## Every language

Each entry carries the same notes in every app language under `translations`,
keyed like the folders in `apps/desktop/src/locales`:

```json
{
  "version": "1.5.0",
  "headline": "…",
  "highlights": [{ "title": "…", "text": "…", "hint": "…", "image": "…" }],
  "translations": {
    "de": {
      "headline": "…",
      "highlights": [{ "title": "…", "text": "…", "hint": "…" }]
    },
    "es": {
      "headline": "…",
      "highlights": [{ "title": "…", "text": "…", "hint": "…" }]
    }
  }
}
```

- Translate in the same change as the English entry, point for point: the same
  number of points in the same order, each with a title and text, and a hint
  where the English point has one.
- Use the page and button names the app shows in that language, and the words in
  `apps/desktop/src/locales/GLOSSARY.md`.
- The translation guard (`pnpm --filter @playcounter/desktop test`) fails when an
  entry misses a language, a point, a title, a text or a hint.

The app shows the notes in its current language and falls back to English when
an entry has no translation for it. `latest.json` keeps the English text in
`notes`, which every installed version reads, and adds the other languages in
`notes_translations`.

If someone skips releases, "What's new" pages through the newest version and
lists the skipped ones last, folded, each with its headline, its points behind
"Show changes" and its guide when it has one: updating from 1.4.1 straight to
1.5.0 shows 1.5.0's pages, then 1.4.3 and 1.4.2. The preview before installing
only ever covers the version being offered.
