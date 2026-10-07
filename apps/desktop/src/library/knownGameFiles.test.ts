import type { LibraryKnownExecutable } from "@playcounter/shared";
import { beforeEach, expect, it, vi } from "vitest";
const { platform } = vi.hoisted(() => ({
  platform: { current: "windows" as "windows" | "macos" | "linux" },
}));
vi.mock("../platform", () => ({ currentPlatform: () => platform.current }));
import { knownGameFiles } from "./knownGameFiles";

const executables: LibraryKnownExecutable[] = [
  {
    platform: "windows",
    kind: "exe",
    value: "RimWorldWin64.exe",
    provenance: "igdb",
    verified: true,
  },
  {
    platform: "macos",
    kind: "process_name",
    value: "RimWorld by Ludeon Studios",
    provenance: "community",
    verified: true,
  },
];

beforeEach(() => {
  platform.current = "windows";
});

it("links the Windows files of a game on Windows", () => {
  expect(knownGameFiles(executables)).toEqual([
    { exeName: "RimWorldWin64.exe", identifierSource: "igdb" },
  ]);
});

it("links only Mac process names on a Mac, never Windows files", () => {
  platform.current = "macos";
  expect(knownGameFiles(executables)).toEqual([
    { exeName: "RimWorld by Ludeon Studios", identifierSource: "community" },
  ]);
});
