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
  is already published.

The desktop app bundles this catalog and shows the notes once after an update.
The release scripts also copy the current entry into Tauri's `latest.json`, so an
older installed app can show what is coming before you install it.

If someone skips releases, the post-update dialog lists every authored version
newer than the last one they saw, newest first: updating from 1.1.4 straight to
1.1.6 shows separate sections for 1.1.6 and 1.1.5. The preview before installing
only ever covers the version being offered.
