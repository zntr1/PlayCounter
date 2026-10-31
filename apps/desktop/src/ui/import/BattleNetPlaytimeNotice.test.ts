// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { createBackupContents } from "../../backup";
import { readPersistedRecord } from "../../persistence";
import { useAppStore } from "../../store";
import { hydrate } from "../../tracker";

it("remembers the OK to Battle.net's playtime notice after a restart, but not in backups", async () => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().markBattleNetPlaytimeNoticeSeen();
  await Promise.resolve();
  expect(readPersistedRecord().battleNetPlaytimeNoticeSeen).toBe(true);
  // Another PC asks again.
  expect(JSON.parse(createBackupContents()).data).not.toHaveProperty(
    "battleNetPlaytimeNoticeSeen",
  );

  useAppStore.setState(useAppStore.getInitialState(), true);
  expect(useAppStore.getState().battleNetPlaytimeNoticeSeen).toBe(false);
  hydrate();
  expect(useAppStore.getState().battleNetPlaytimeNoticeSeen).toBe(true);
});
