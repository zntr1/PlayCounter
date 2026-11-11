// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { createBackupContents } from "../../backup";
import { readPersistedRecord } from "../../persistence";
import { useAppStore } from "../../store";
import { hydrate } from "../../tracker";

const leftovers =
  "Some Xbox folders still hold game files that Windows no longer has installed; they were skipped.";

// Phil, 2026-11-11: a closed scan warning never comes back, also after a
// restart. It belongs to this PC's folders, so backups leave it out.
it("remembers closed scan warnings after a restart, but not in backups", async () => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().closeScanWarnings([leftovers]);
  await Promise.resolve();
  expect(readPersistedRecord().closedScanWarnings).toEqual([leftovers]);
  expect(JSON.parse(createBackupContents()).data).not.toHaveProperty(
    "closedScanWarnings",
  );

  useAppStore.setState(useAppStore.getInitialState(), true);
  expect(useAppStore.getState().closedScanWarnings).toEqual([]);
  hydrate();
  expect(useAppStore.getState().closedScanWarnings).toEqual([leftovers]);
});
