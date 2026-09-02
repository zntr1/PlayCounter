# Errors

## 2026-09-02 — Browser clipboard capture during Xbox fallback verification

**What didn't work:** Replacing `navigator.clipboard.writeText` from `page.evaluate` did not expose the captured value back to later browser-tool evaluations, even though the application click handler completed successfully.

**What worked instead:** Verified the rendered fallback control and the application's visible `Sign-in link copied` success toast, while provider tests verified that the exact backend authorization URL is delivered to the UI callback.

**Note for next time:** Treat browser-tool clipboard stubs as execution-context-local. Verify clipboard handlers through application feedback plus a focused unit test for the URL handoff.

## 2026-09-02 — Mocking importer fetches in the browser surface

**What didn't work:** Replacing `window.fetch` from browser evaluation did not intercept requests made by the already-loaded importer module, so a synthetic terminal Xbox failure could not be driven through that page instance.

**What worked instead:** Used backend and desktop contract tests for the staged failure payload and message, then browser-verified the persistent recovery guidance, copy action, and post-cancel return state on the actual surface.

**Note for next time:** Start the UI against a dedicated mock API endpoint before module load instead of patching `window.fetch` after the importer has mounted.

## 2026-09-02 — Rendering an isolated Vite React component in browser verification

**What didn't work:** Dynamically importing React, ReactDOM and `ImportRow` into the already-running Vite page created no committed preview DOM, so the isolated Xbox row could not be screenshot reliably.

**What worked instead:** Rendered the real `ImportRow` through ReactDOM server in the focused test and asserted that unresolved Xbox rows contain neither an image nor placeholder SVG; the normal desktop typecheck also passed.

**Note for next time:** Add a dedicated in-app visual fixture or test route for stateful importer rows instead of mounting a second React root into the live application shell.
